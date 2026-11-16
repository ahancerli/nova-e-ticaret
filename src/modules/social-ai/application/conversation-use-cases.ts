import { UnitOfWork, isAppError } from "@/core";
import { formatMinor } from "@/lib/money";
import type { Actor } from "@/modules/shared/actor";
import { SocialAiErrors } from "../domain/errors";
import type { ReferralContext } from "../domain/prompt";
import {
  CHANNELS, HISTORY_LIMIT, REPLY_DEBOUNCE_MS, RETENTION_DAYS, cleanMessage, isChannel, previewOf, splitMessage, windowState, withinHours,
  type Channel, type ConversationDetail, type ConversationList, type ConversationStatus, type ConversationSummary, type InboundMessage,
} from "../domain/social-ai";
import type { ConversationFilter, StoredChannel, StoredConversation } from "../infrastructure/d1-social-ai.repository";
import { metaSignatureValid } from "../infrastructure/meta-signature";
import { FALLBACK_REPLY, type BotReply } from "./bot-brain";
import { ChannelSendError, type ChannelCredentials, type ContactProfile } from "./ports";
import { CONVERSATION_HREF, appSecrets, credentialsOf, istanbulDayStart, reportChannelError, seal, type SocialAiDeps } from "./shared";

/** How long one bot answer may take before another worker may pick the conversation up. */
const LOCK_MS = 120_000;
/** The outbox retries a send only after the immediate attempt had time to finish. */
const SEND_RETRY_AFTER_MS = 120_000;
/** A provider hiccup is retried while the customer's message is this fresh; after that staff take over. */
const AI_RETRY_WINDOW_MS = 5 * 60_000;
const AI_RETRY_DELAY_MS = 30_000;
const TRANSIENT_AI = new Set(["ai_provider_busy", "ai_rate_limited", "ai_timeout", "ai_provider_error"]);
const DAY_MS = 86_400_000;
const isUnique = (err: unknown) => /UNIQUE constraint failed/i.test(err instanceof Error ? err.message : String(err));

export type ProcessOutcome = "replied" | "handoff" | "off_hours" | "limit" | "retry" | "skipped";

/**
 * Webhook intake (one endpoint for every Meta channel). Verifies the signature, turns the payload into common
 * messages through the channel's adapter and stores them — fast, no AI call: answering happens after the response.
 */
export class ReceiveWebhook {
  constructor(private readonly deps: SocialAiDeps) {}

  /** GET verification request: echo `hub.challenge` when `hub.verify_token` is ours. */
  async challenge(mode: string | null, token: string | null, challenge: string | null): Promise<string | null> {
    const app = await this.deps.repo.app();
    return mode === "subscribe" && !!token && !!app.verifyToken && token === app.verifyToken && challenge ? challenge : null;
  }

  async execute(rawBody: string, signature: string | null): Promise<{ accepted: boolean; conversationIds: string[] }> {
    const secrets = await appSecrets(this.deps);
    if (!(await metaSignatureValid(rawBody, signature, [secrets.appSecret, secrets.igAppSecret].filter((s): s is string => !!s)))) return { accepted: false, conversationIds: [] };
    let payload: unknown;
    try { payload = JSON.parse(rawBody); } catch { return { accepted: true, conversationIds: [] }; }
    const object = (payload as { object?: unknown } | null)?.object;
    const channel = (["whatsapp", "instagram"] as Channel[]).find((c) => this.deps.adapters(c).webhookObject === object);
    if (!channel) {
      this.deps.logger.info("meta webhook ignored: unknown object", { object: typeof object === "string" ? object.slice(0, 40) : null });
      return { accepted: true, conversationIds: [] };
    }

    const connection = await this.deps.repo.channel(channel);
    const touched = new Set<string>();
    const parsed = this.deps.adapters(channel).parse(payload);
    const foreign = new Set<string>();
    for (const message of parsed) {
      // Another account of the same Meta app, or a channel that was switched off / disconnected: not ours to answer.
      if (!connection?.isEnabled || connection.externalId !== message.accountId) { foreign.add(message.accountId); continue; }
      const id = await this.store(message);
      if (id) touched.add(id);
    }
    // Counts and account ids only (never message text): makes "Meta sent nothing" and "sent but dropped" tell apart.
    this.deps.logger.info("meta webhook received", {
      channel, messages: parsed.length, stored: touched.size,      ...(foreign.size ? { ignoredAccounts: [...foreign].slice(0, 5), connectedAccount: connection?.externalId ?? null, enabled: connection?.isEnabled ?? false } : {}),
    });
    return { accepted: true, conversationIds: [...touched] };
  }

  /** Idempotent on Meta's message id; returns the conversation that now has something to answer. */
  private async store(m: InboundMessage): Promise<string | null> {
    if (await this.deps.repo.messageExists(m.channel, m.externalId)) return null;
    const existing = await this.deps.repo.conversationOf(m.channel, m.contactId);
    const conversationId = existing?.id ?? this.deps.ids.newId();
    const now = this.deps.clock.now();
    try {
      await this.deps.db.batch(this.deps.repo.inboundStatements({
        conversationId, messageId: this.deps.ids.newId(), channel: m.channel, contactId: m.contactId.slice(0, 80), contactName: m.contactName?.slice(0, 120) ?? null,
        externalId: m.externalId, text: cleanMessage(m.text).slice(0, 4000) || "[boş mesaj]", at: now.toISOString(), referral: m.referral,
        replyDueAt: new Date(now.getTime() + REPLY_DEBOUNCE_MS).toISOString(),
      }));
    } catch (err) {
      if (isUnique(err)) return null; // the same delivery raced us
      throw err;
    }
    // A conversation created by a concurrent first message keeps its own id.
    return existing?.id ?? (await this.deps.repo.conversationOf(m.channel, m.contactId))?.id ?? null;
  }
}

/** Sends one stored outgoing message (right after it is written, and again from the outbox if that failed). */
export class DeliverMessage {
  constructor(private readonly deps: SocialAiDeps) {}

  /** Throws on a failure worth retrying (the outbox backs off); everything final is recorded on the message. */
  async execute(messageId: string): Promise<"sent" | "blocked" | "failed" | "skipped"> {
    const { repo, clock } = this.deps;
    const message = await repo.message(messageId);
    if (!message || message.status !== "pending" || !isChannel(message.channel)) return "skipped";
    const [conversation, connection] = await Promise.all([repo.conversation(message.conversationId), repo.channel(message.channel)]);
    if (!conversation || !connection) {
      await repo.settleMessage(messageId, "failed", null, "Kanal bağlı değil.");
      return "failed";
    }
    const window = windowState(message.channel, conversation.lastInboundAt, clock.now(), message.humanAgent);
    if (!window.open) {
      await repo.settleMessage(messageId, "blocked", null, `Mesajlaşma penceresi kapalı (müşterinin son mesajından sonra ${message.humanAgent ? CHANNELS[message.channel].humanAgentWindowHours : CHANNELS[message.channel].windowHours} saat).`);
      return "blocked";
    }
    // The Human Agent tag is only needed past the standard window, and Meta refuses it until the app has that feature
    // approved in App Review (code 10) — so inside the window a staff reply goes out as a normal message.
    const tagged = message.humanAgent && !windowState(message.channel, conversation.lastInboundAt, clock.now()).open;
    try {
      const sent = await this.deps.adapters(message.channel).send(await credentialsOf(this.deps, connection), {
        to: conversation.contactId, text: message.body, humanAgent: tagged, linkPreview: /https?:\/\//.test(message.body),
      });
      await repo.settleMessage(messageId, "sent", sent.externalId, null);
      if (connection.status === "error") await this.deps.db.batch([repo.channelErrorStatement(message.channel, null, clock.nowIso())]);
      return "sent";
    } catch (err) {
      const permanent = err instanceof ChannelSendError ? err.permanent : isAppError(err);
      const text = err instanceof Error ? err.message : String(err);
      this.deps.logger.warn("social ai send failed", { messageId, channel: message.channel, permanent, error: text.slice(0, 200) });
      if (!permanent) throw err;
      await repo.settleMessage(messageId, "failed", null, err instanceof ChannelSendError && err.code ? `Meta hata kodu ${err.code}` : "Gönderilemedi.");
      if ((err instanceof ChannelSendError && err.auth) || (isAppError(err) && err.code === "social_ai_secret_unreadable")) {
        await reportChannelError(this.deps, message.channel, "Meta erişim anahtarını kabul etmiyor; mesajlar gönderilemiyor.");
      }
      return "failed";
    }
  }
}

/**
 * Conversation service: answers what a customer wrote. One conversation is answered by one worker at a time (lock on
 * the row) and all messages that piled up during the debounce get a single answer.
 */
export class ProcessConversation {
  constructor(private readonly deps: SocialAiDeps, private readonly deliver: DeliverMessage) {}

  async execute(conversationId: string): Promise<ProcessOutcome> {
    const { repo, clock } = this.deps;
    const startedAt = clock.now();
    const lockUntil = new Date(startedAt.getTime() + LOCK_MS).toISOString();
    if (!(await repo.claim(conversationId, startedAt.toISOString(), lockUntil))) return "skipped";

    const conversation = await repo.conversation(conversationId);
    const pending = await repo.pendingInbound(conversationId);
    const connection = conversation && isChannel(conversation.channel) ? await repo.channel(conversation.channel) : null;
    if (!conversation || !pending.length || !connection?.isEnabled) {
      await this.deps.db.batch([...repo.markHandledStatements(pending.map((m) => m.id), startedAt.toISOString()), repo.releaseStatement(conversationId, lockUntil, { now: startedAt.toISOString() })]);
      return "skipped";
    }
    const pendingIds = pending.map((m) => m.id);
    const settings = await repo.settings();
    const history = await repo.history(conversationId, HISTORY_LIMIT);

    if (settings.hoursEnabled && !withinHours(settings.hours, startedAt)) {
      // Said once per quiet period, not after every message.
      const already = history.some((m) => m.sender === "bot" && m.body === settings.offHoursMessage && startedAt.getTime() - Date.parse(m.createdAt) < 12 * 3_600_000);
      await this.finish(conversation, lockUntil, pendingIds, already ? [] : [settings.offHoursMessage], null, null);
      return "off_hours";
    }

    const counts = await repo.botReplyCounts(conversationId, new Date(startedAt.getTime() - DAY_MS).toISOString(), istanbulDayStart(startedAt));
    if (counts.conversation >= settings.conversationLimit || counts.today >= settings.dailyLimit) {
      const reason = counts.today >= settings.dailyLimit ? "Günlük bot cevabı limiti doldu." : "Bu konuşmadaki bot cevabı limiti doldu.";
      await this.finish(conversation, lockUntil, pendingIds, [FALLBACK_REPLY], null, reason);
      return "limit";
    }

    let reply: BotReply;
    try {
      reply = await this.deps.brain.reply({
        channel: conversation.channel, settings, welcomeMessage: connection.welcomeMessage ?? settings.welcomeMessage,
        history: history.filter((m) => m.status !== "failed" && m.status !== "blocked").map((m) => ({ role: m.direction === "in" ? "user" as const : "assistant" as const, text: m.body })),
        referral: await this.referralContext(conversation), firstReply: !history.some((m) => m.direction === "out"),
        contactPhone: conversation.channel === "whatsapp" ? conversation.contactId : null,
      });
    } catch (err) {
      const code = isAppError(err) ? err.code : "error";
      this.deps.logger.warn("social ai reply failed", { conversationId, code, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
      const fresh = startedAt.getTime() - Date.parse(pending[0]!.createdAt) < AI_RETRY_WINDOW_MS;
      if (TRANSIENT_AI.has(code) && fresh) {
        await this.deps.db.batch([repo.releaseStatement(conversationId, lockUntil, { now: startedAt.toISOString(), retryAt: new Date(clock.now().getTime() + AI_RETRY_DELAY_MS).toISOString() })]);
        return "retry";
      }
      await this.finish(conversation, lockUntil, pendingIds, [FALLBACK_REPLY], null, `AI yanıt üretemedi (${code}). AI entegrasyonunu kontrol edin.`);
      return "handoff";
    }

    await this.finish(conversation, lockUntil, pendingIds, [...splitMessage(reply.text, conversation.channel), ...reply.links], reply, reply.handoffReason);
    return reply.handoffReason ? "handoff" : "replied";
  }

  private async referralContext(c: StoredConversation): Promise<ReferralContext | null> {
    if (!c.referral) return null;
    const map = await this.deps.repo.referralMapFor([c.referral.sourceId ?? "", c.referral.ref ?? ""], c.referral.type);
    const products = map?.productIds.length ? await this.deps.knowledge.productsByIds(map.productIds) : [];
    return {
      referral: c.referral, label: map?.label ?? null, extraPrompt: map?.extraPrompt ?? "",
      products: products.map((p) => ({ id: p.id, name: p.name, priceText: p.priceMinor == null ? null : formatMinor(p.cartPriceMinor ?? p.priceMinor), inStock: p.inStock, url: p.url })),
    };
  }

  /** Writes the answer, the tool log, the hand-off and its notification in one batch, then sends. */
  private async finish(c: StoredConversation, lockUntil: string, handledIds: string[], texts: string[], reply: BotReply | null, handoffReason: string | null): Promise<void> {
    const { repo, ids, clock } = this.deps;
    const now = clock.now();
    const nowIso = now.toISOString();
    // One millisecond apart so the stored order is the sending order.
    const out = texts.filter((t) => t.trim()).map((body, i) => ({ id: ids.newId(), body: body.slice(0, 4000), at: new Date(now.getTime() + i).toISOString() }));
    const uow = new UnitOfWork(this.deps.db);
    uow.add(...repo.markHandledStatements(handledIds, nowIso));
    for (const m of out) {
      uow.add(repo.outboundStatement({ id: m.id, conversationId: c.id, channel: c.channel, sender: "bot", authorId: null, body: m.body, humanAgent: false, at: m.at }));
      uow.add(repo.sendOutboxStatement(ids.newId(), m.id, new Date(now.getTime() + SEND_RETRY_AFTER_MS).toISOString()));
    }
    for (const t of reply?.tools ?? []) {
      uow.add(repo.toolCallStatement({ id: ids.newId(), conversationId: c.id, messageId: out[0]?.id ?? null, name: t.name, input: t.input, outputPreview: t.outputPreview, ok: t.ok, at: nowIso }));
    }
    const last = out.at(-1);
    uow.add(repo.releaseStatement(c.id, lockUntil, {
      now: nowIso, status: handoffReason ? "handoff" : "bot", handoffReason, last: last ? { preview: previewOf(last.body), sender: "bot" } : undefined,
    })).expectChanges(1, SocialAiErrors.conversationChanged);
    if (handoffReason) {
      uow.add(...(await this.deps.notifications.statements({
        type: "social_ai.handoff", title: `${CHANNELS[c.channel].label} konuşması devredildi: ${c.contactName ?? c.contactId}`, body: handoffReason, href: CONVERSATION_HREF(c.id),
        entityType: "social_ai_conversation", entityId: c.id, dedupeKey: `social_ai.handoff:${c.id}:${nowIso}`,
      })));
    }
    await uow.commit();
    for (const m of out) {
      try { await this.deliver.execute(m.id); } catch { /* the outbox retries */ }
    }
  }
}

/** Cron safety net (and the debounce timer's worker): answers every conversation that is due. */
export class ProcessDueConversations {
  constructor(private readonly deps: SocialAiDeps, private readonly process: ProcessConversation) {}

  async execute(limit = 10): Promise<{ due: number; outcomes: Partial<Record<ProcessOutcome, number>> }> {
    const ids = await this.deps.repo.dueConversations(this.deps.clock.nowIso(), limit);
    const outcomes: Partial<Record<ProcessOutcome, number>> = {};
    for (const id of ids) {
      try {
        const outcome = await this.process.execute(id);
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      } catch (err) {
        this.deps.logger.error("social ai conversation failed", { conversationId: id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { due: ids.length, outcomes };
  }
}

// --- panel: conversations ---------------------------------------------------------------------------------------

const summaryOf = (c: StoredConversation): ConversationSummary => ({
  id: c.id, channel: c.channel, contactId: c.contactId, contactName: c.contactName, contactUsername: null, contactAvatarUrl: null, status: c.status, referralSource: c.referralSource,
  referralLabel: c.referralLabel, lastMessageAt: c.lastMessageAt, lastPreview: c.lastPreview, lastSender: c.lastSender, staffUnread: c.staffUnread, handoffReason: c.handoffReason,
  createdAt: c.createdAt,
});

/**
 * Contact profiles are read live from the channel when the panel shows a conversation — never stored. Answers (and
 * failures, for a shorter time) are kept in process memory so paging through the list does not call Meta every time.
 */
const PROFILE_TTL_MS = 10 * 60_000;
const PROFILE_FAIL_TTL_MS = 60_000;
const profileCache = new Map<string, { until: number; profile: ContactProfile | null }>();

async function withProfiles<T extends ConversationSummary>(deps: SocialAiDeps, rows: T[]): Promise<T[]> {
  const wanted = [...new Set(rows.filter((r) => r.channel === "instagram").map((r) => r.contactId))];
  const adapter = deps.adapters("instagram");
  if (!wanted.length || !adapter.profile) return rows;
  const connection = await deps.repo.channel("instagram");
  if (!connection) return rows;
  let credentials: ChannelCredentials;
  try { credentials = await credentialsOf(deps, connection); } catch { return rows; }
  const now = deps.clock.now().getTime();
  if (profileCache.size > 5000) profileCache.clear();
  const found = new Map(await Promise.all(wanted.map(async (contactId) => {
    const key = `${connection.externalId}:${contactId}`;
    const hit = profileCache.get(key);
    if (hit && hit.until > now) return [contactId, hit.profile] as const;
    let profile: ContactProfile | null = null;
    try { profile = await adapter.profile!(credentials, contactId); } catch (err) {
      deps.logger.warn("instagram profile lookup failed", { error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    }
    profileCache.set(key, { until: now + (profile ? PROFILE_TTL_MS : PROFILE_FAIL_TTL_MS), profile });
    return [contactId, profile] as const;
  })));
  return rows.map((r) => {
    const p = r.channel === "instagram" ? found.get(r.contactId) : null;
    return p ? { ...r, contactName: r.contactName ?? p.name, contactUsername: p.username, contactAvatarUrl: p.avatarUrl } : r;
  });
}

export class ListConversations {
  constructor(private readonly deps: SocialAiDeps) {}
  async execute(filter: ConversationFilter): Promise<ConversationList> {
    const { rows, ...rest } = await this.deps.repo.list(filter);
    return { rows: await withProfiles(this.deps, rows.map(summaryOf)), ...rest };
  }
}

export class GetConversation {
  constructor(private readonly deps: SocialAiDeps) {}
  async execute(id: string): Promise<ConversationDetail | null> {
    const c = await this.deps.repo.conversation(id);
    if (!c || !isChannel(c.channel)) return null;
    const [messages, toolCalls, profiled] = await Promise.all([this.deps.repo.messages(id, 200), this.deps.repo.toolCalls(id, 200), withProfiles(this.deps, [summaryOf(c)])]);
    return {
      ...profiled[0]!, referral: c.referral,
      messages: messages.map((m) => ({ id: m.id, direction: m.direction, sender: m.sender, authorName: m.authorName, body: m.body, status: m.status, error: m.error, createdAt: m.createdAt })),
      toolCalls, staffWindow: windowState(c.channel, c.lastInboundAt, this.deps.clock.now(), true),
    };
  }
}

/** Command: staff take a conversation over, give it back to the bot or close it. */
export class SetConversationStatus {
  constructor(private readonly deps: SocialAiDeps) {}

  async execute(id: string, status: ConversationStatus, actor: Actor): Promise<void> {
    const { repo } = this.deps;
    const c = await repo.conversation(id);
    if (!c) throw SocialAiErrors.conversationNotFound();
    if (c.status === status) return;
    const now = this.deps.clock.nowIso();
    await new UnitOfWork(this.deps.db)
      .add(repo.skipPendingStatement(id, now))
      .add(repo.staffTouchStatement(id, { status, reason: status === "handoff" ? "Personel konuşmayı devraldı." : null, now, fromStatus: c.status }))
      .expectChanges(1, SocialAiErrors.conversationChanged)
      .add(this.deps.notifications.dismissStatement("social_ai.handoff", "social_ai_conversation", [id]))
      .add(this.deps.audit.recordStatement({
        actor, action: status === "handoff" ? "social_ai.handoff" : status === "bot" ? "social_ai.resume_bot" : "social_ai.close", entityType: "social_ai_conversation", entityId: id,
        diff: { channel: c.channel, from: c.status, to: status },
      }))
      .commit();
  }
}

export class MarkConversationRead {
  constructor(private readonly deps: SocialAiDeps) {}
  async execute(id: string): Promise<void> {
    await this.deps.db.batch([this.deps.repo.markReadStatement(id), this.deps.notifications.dismissStatement("social_ai.handoff", "social_ai_conversation", [id])]);
  }
}

/**
 * Command: a person answers from the panel. Writing takes the conversation over (the bot stays silent in it until it
 * is given back). Refused when the channel's window for human replies has closed.
 */
export class SendStaffReply {
  constructor(private readonly deps: SocialAiDeps, private readonly deliver: DeliverMessage) {}

  async execute(id: string, text: string, actor: Actor): Promise<{ messageId: string; delivery: "sent" | "blocked" | "failed" | "pending" }> {
    const { repo, ids, clock } = this.deps;
    const c = await repo.conversation(id);
    if (!c || !isChannel(c.channel)) throw SocialAiErrors.conversationNotFound();
    if (!(await repo.channel(c.channel))) throw SocialAiErrors.notConnected();
    const now = clock.now();
    if (!windowState(c.channel, c.lastInboundAt, now, true).open) throw SocialAiErrors.windowClosed(CHANNELS[c.channel].label, CHANNELS[c.channel].humanAgentWindowHours);

    const parts = splitMessage(cleanMessage(text), c.channel);
    const out = parts.map((body, i) => ({ id: ids.newId(), body, at: new Date(now.getTime() + i).toISOString() }));
    const nowIso = now.toISOString();
    const uow = new UnitOfWork(this.deps.db);
    uow.add(repo.skipPendingStatement(id, nowIso));
    for (const m of out) {
      uow.add(repo.outboundStatement({ id: m.id, conversationId: id, channel: c.channel, sender: "staff", authorId: actor.userId, body: m.body, humanAgent: true, at: m.at }));
      uow.add(repo.sendOutboxStatement(ids.newId(), m.id, new Date(now.getTime() + SEND_RETRY_AFTER_MS).toISOString()));
    }
    await uow
      .add(repo.staffTouchStatement(id, { status: "handoff", reason: c.status === "handoff" ? null : "Personel konuşmayı devraldı.", now: nowIso, last: { preview: previewOf(out.at(-1)!.body), sender: "staff" } }))
      .expectChanges(1, SocialAiErrors.conversationChanged)
      .add(this.deps.notifications.dismissStatement("social_ai.handoff", "social_ai_conversation", [id]))
      // The text itself is customer correspondence: it lives in the conversation (30 days), not in the audit trail.
      .add(this.deps.audit.recordStatement({ actor, action: "social_ai.staff_reply", entityType: "social_ai_conversation", entityId: id, diff: { channel: c.channel, messages: out.length } }))
      .commit();

    let delivery: "sent" | "blocked" | "failed" | "pending" = "pending";
    for (const m of out) {
      try {
        const r = await this.deliver.execute(m.id);
        delivery = r === "skipped" ? delivery : r;
      } catch { delivery = "pending"; /* the outbox retries */ }
    }
    return { messageId: out[0]!.id, delivery };
  }
}

/**
 * Daily job (KVKK data minimisation): messages, tool calls and referrals older than 30 days are deleted for good, then
 * conversations left empty. The audit entry carries row counts only. Running it again deletes nothing.
 */
export class RunRetention {
  constructor(private readonly deps: SocialAiDeps) {}

  async execute(): Promise<{ before: string; toolCalls: number; messages: number; conversations: number }> {
    const before = new Date(this.deps.clock.now().getTime() - RETENTION_DAYS * DAY_MS).toISOString();
    const [tools, messages, conversations] = await this.deps.db.batch(this.deps.repo.retentionStatements(before));
    const deleted = { toolCalls: tools?.meta.changes ?? 0, messages: messages?.meta.changes ?? 0, conversations: conversations?.meta.changes ?? 0 };
    if (deleted.toolCalls + deleted.messages + deleted.conversations > 0) {
      await this.deps.db.batch([this.deps.repo.systemAuditStatement(this.deps.ids.newId(), "social_ai.retention", deleted)]);
    }
    return { before, ...deleted };
  }
}

/** Daily job: Instagram tokens live 60 days and are renewed while still valid; a token that cannot be renewed raises a panel notification. */
export class RefreshChannelTokens {
  constructor(private readonly deps: SocialAiDeps) {}

  async execute(): Promise<{ refreshed: Channel[]; failed: Channel[] }> {
    const { repo, clock } = this.deps;
    const now = clock.now();
    const out = { refreshed: [] as Channel[], failed: [] as Channel[] };
    for (const ch of await repo.channels()) {
      if (ch.channel !== "instagram" || !ch.tokenExpiresAt) continue;
      const left = Date.parse(ch.tokenExpiresAt) - now.getTime();
      if (left > 20 * DAY_MS) continue;
      if (left <= 0) { await this.fail(ch, "Instagram erişim anahtarının süresi doldu. Hesabı yeniden bağlayın."); out.failed.push(ch.channel); continue; }
      try {
        const fresh = await this.deps.meta.refreshInstagramToken((await credentialsOf(this.deps, ch)).accessToken);
        await this.deps.db.batch([repo.tokenStatement(ch.channel, await seal(this.deps, fresh.accessToken), new Date(now.getTime() + fresh.expiresIn * 1000).toISOString())]);
        out.refreshed.push(ch.channel);
      } catch (err) {
        this.deps.logger.warn("social ai token refresh failed", { channel: ch.channel, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
        // Still weeks away: try again tomorrow quietly. Close to expiry: staff must know.
        if (left < 7 * DAY_MS) { await this.fail(ch, "Instagram erişim anahtarı yenilenemedi; süresi dolmadan hesabı yeniden bağlayın."); out.failed.push(ch.channel); }
      }
    }
    return out;
  }

  private fail(ch: StoredChannel, message: string) {
    return reportChannelError(this.deps, ch.channel, message);
  }
}
