import { Repository, placeholders, type Statement } from "@/core";
import type { Sealed } from "../application/ports";
import {
  DEFAULT_HOURS, isClock, previewOf,
  type BotExample, type BotSettings, type BotSettingsView, type Channel, type ChannelStats, type ChannelView, type ConversationStatus, type ConversationSummary, type MessageSender,
  type MessageStatus, type MessageView, type Referral, type ReferralMap, type ReferralType, type ToolCallView, type WorkingHours,
} from "../domain/social-ai";

type AppRow = {
  app_id: string | null; ig_app_id: string | null; wa_config_id: string | null; verify_token: string; secrets_ciphertext: string | null; secrets_nonce: string | null;
  secrets_auth_tag: string | null; key_version: string | null; updated_at: string;
};
export interface StoredApp {
  appId: string | null; igAppId: string | null; waConfigId: string | null; verifyToken: string; secrets: Sealed | null; updatedAt: string;
}

type ChannelRow = {
  channel: Channel; is_enabled: number; status: "connected" | "error"; external_id: string; account_id: string | null; display_name: string | null; token_ciphertext: string;
  token_nonce: string; token_auth_tag: string; key_version: string; token_expires_at: string | null; connected_via: "oauth" | "manual"; welcome_message: string | null;
  last_error: string | null; last_error_at: string | null; last_inbound_at: string | null; connected_at: string; updated_at: string; connected_by_name: string | null;
};
export interface StoredChannel extends ChannelView { token: Sealed }

type SettingsRow = {
  tone: BotSettings["tone"]; tone_note: string; welcome_message: string; rules_text: string; bans_text: string; examples_json: string; hours_enabled: number; hours_json: string;
  off_hours_message: string; handoff_rules: string; conversation_limit: number; daily_limit: number; updated_at: string; updated_by_name: string | null;
};

type ConversationRow = {
  id: string; channel: Channel; contact_id: string; contact_name: string | null; status: ConversationStatus; referral_json: string | null; referral_source: string | null;
  last_inbound_at: string | null; last_message_at: string | null; last_preview: string | null; last_sender: MessageSender | null; staff_unread: number; reply_due_at: string | null;
  handoff_reason: string | null; created_at: string; referral_label?: string | null;
};
export interface StoredConversation extends ConversationSummary { referral: Referral | null; lastInboundAt: string | null; replyDueAt: string | null }

export interface StoredMessage extends MessageView { conversationId: string; channel: Channel; externalId: string | null; humanAgent: boolean; handledAt: string | null }
type MessageRow = {
  id: string; conversation_id: string; channel: Channel; direction: "in" | "out"; sender: MessageSender; body: string; external_id: string | null; status: MessageStatus;
  error: string | null; human_agent: number; handled_at: string | null; created_at: string; author_name: string | null;
};

export interface ConversationFilter {
  channel?: Channel; status?: ConversationStatus; source?: string; from?: string; to?: string; q?: string; page: number; pageSize: number;
}

const parse = <T>(json: string | null, fallback: T): T => {
  if (!json) return fallback;
  try { return JSON.parse(json) as T; } catch { return fallback; }
};

const toChannel = (r: ChannelRow): StoredChannel => ({
  channel: r.channel, isEnabled: r.is_enabled === 1, status: r.status, externalId: r.external_id, accountId: r.account_id, displayName: r.display_name,
  tokenExpiresAt: r.token_expires_at, connectedVia: r.connected_via, welcomeMessage: r.welcome_message, lastError: r.last_error, lastErrorAt: r.last_error_at,
  lastInboundAt: r.last_inbound_at, connectedAt: r.connected_at, connectedByName: r.connected_by_name, updatedAt: r.updated_at,
  token: { ciphertext: r.token_ciphertext, nonce: r.token_nonce, authTag: r.token_auth_tag, keyVersion: r.key_version },
});

const toConversation = (r: ConversationRow): StoredConversation => ({
  id: r.id, channel: r.channel, contactId: r.contact_id, contactName: r.contact_name, contactUsername: null, contactAvatarUrl: null, status: r.status, referralSource: r.referral_source, referralLabel: r.referral_label ?? null,
  lastMessageAt: r.last_message_at, lastPreview: r.last_preview, lastSender: r.last_sender, staffUnread: r.staff_unread, handoffReason: r.handoff_reason, createdAt: r.created_at,
  referral: parse<Referral | null>(r.referral_json, null), lastInboundAt: r.last_inbound_at, replyDueAt: r.reply_due_at,
});

const toMessage = (r: MessageRow): StoredMessage => ({
  id: r.id, conversationId: r.conversation_id, channel: r.channel, direction: r.direction, sender: r.sender, authorName: r.author_name, body: r.body, status: r.status, error: r.error,
  createdAt: r.created_at, externalId: r.external_id, humanAgent: r.human_agent === 1, handledAt: r.handled_at,
});

const CONVERSATION_COLUMNS = `c.id, c.channel, c.contact_id, c.contact_name, c.status, c.referral_json, c.referral_source, c.last_inbound_at, c.last_message_at, c.last_preview,
  c.last_sender, c.staff_unread, c.reply_due_at, c.handoff_reason, c.created_at,
  (SELECT m.label FROM social_ai_referral_maps m WHERE m.source_id = c.referral_source LIMIT 1) AS referral_label`;
const MESSAGE_COLUMNS = `m.id, m.conversation_id, m.channel, m.direction, m.sender, m.body, m.external_id, m.status, m.error, m.human_agent, m.handled_at, m.created_at,
  (SELECT u.display_name FROM users u WHERE u.id = m.author_id) AS author_name`;
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** SQL of the Social AI Marketing module (app, channels, settings, referral maps, conversations, messages, tool calls). */
export class D1SocialAiRepository extends Repository {
  // --- Meta app -------------------------------------------------------------------------------------------------
  async app(): Promise<StoredApp> {
    const r = await this.db.first<AppRow>("SELECT * FROM social_ai_app WHERE id = 1");
    return {
      appId: r?.app_id ?? null, igAppId: r?.ig_app_id ?? null, waConfigId: r?.wa_config_id ?? null, verifyToken: r?.verify_token ?? "", updatedAt: r?.updated_at ?? "",
      secrets: r?.secrets_ciphertext && r.secrets_nonce && r.secrets_auth_tag ? { ciphertext: r.secrets_ciphertext, nonce: r.secrets_nonce, authTag: r.secrets_auth_tag, keyVersion: r.key_version ?? "v1" } : null,
    };
  }

  /** Guarded by updated_at; `secrets` null keeps the stored ones. */
  saveAppStatement(a: { appId: string | null; igAppId: string | null; waConfigId: string | null; secrets: Sealed | null; actorId: string; now: string }, expectedUpdatedAt: string): Statement {
    return this.db.statement(
      `UPDATE social_ai_app SET app_id = ?, ig_app_id = ?, wa_config_id = ?, secrets_ciphertext = COALESCE(?, secrets_ciphertext), secrets_nonce = COALESCE(?, secrets_nonce),
              secrets_auth_tag = COALESCE(?, secrets_auth_tag), key_version = COALESCE(?, key_version), updated_by = ?, updated_at = ?
        WHERE id = 1 AND updated_at = ?`,
      a.appId, a.igAppId, a.waConfigId, a.secrets?.ciphertext ?? null, a.secrets?.nonce ?? null, a.secrets?.authTag ?? null, a.secrets?.keyVersion ?? null, a.actorId, a.now, expectedUpdatedAt,
    );
  }

  // --- channels -------------------------------------------------------------------------------------------------
  async channel(channel: Channel): Promise<StoredChannel | null> {
    const r = await this.db.first<ChannelRow>(
      "SELECT ch.*, (SELECT u.display_name FROM users u WHERE u.id = ch.connected_by) AS connected_by_name FROM social_ai_channels ch WHERE ch.channel = ?", channel);
    return r ? toChannel(r) : null;
  }

  async channels(): Promise<StoredChannel[]> {
    return (await this.db.all<ChannelRow>("SELECT ch.*, NULL AS connected_by_name FROM social_ai_channels ch")).map(toChannel);
  }

  /** A new connection replaces the row of that channel (reconnect with another account). */
  connectStatements(c: { channel: Channel; externalId: string; accountId: string | null; displayName: string | null; token: Sealed; tokenExpiresAt: string | null; via: "oauth" | "manual"; actorId: string; now: string }): Statement[] {
    return [
      this.db.statement("DELETE FROM social_ai_channels WHERE channel = ?", c.channel),
      this.db.statement(
        `INSERT INTO social_ai_channels (channel, is_enabled, status, external_id, account_id, display_name, token_ciphertext, token_nonce, token_auth_tag, key_version, token_expires_at,
                                         connected_via, connected_by, connected_at, updated_at)
         VALUES (?, 1, 'connected', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        c.channel, c.externalId, c.accountId, c.displayName, c.token.ciphertext, c.token.nonce, c.token.authTag, c.token.keyVersion, c.tokenExpiresAt, c.via, c.actorId, c.now, c.now,
      ),
    ];
  }

  updateChannelStatement(channel: Channel, patch: { isEnabled: boolean; welcomeMessage: string | null; now: string }, expectedUpdatedAt: string): Statement {
    return this.db.statement("UPDATE social_ai_channels SET is_enabled = ?, welcome_message = ?, updated_at = ? WHERE channel = ? AND updated_at = ?",
      patch.isEnabled ? 1 : 0, patch.welcomeMessage, patch.now, channel, expectedUpdatedAt);
  }

  disconnectStatement(channel: Channel): Statement {
    return this.db.statement("DELETE FROM social_ai_channels WHERE channel = ?", channel);
  }

  /** Health notes do not touch updated_at (they must not break an open panel form). */
  channelErrorStatement(channel: Channel, error: string | null, now: string): Statement {
    return error
      ? this.db.statement("UPDATE social_ai_channels SET status = 'error', last_error = ?, last_error_at = ? WHERE channel = ?", error.slice(0, 480), now, channel)
      : this.db.statement("UPDATE social_ai_channels SET status = 'connected', last_error = NULL, last_error_at = NULL WHERE channel = ? AND status = 'error'", channel);
  }

  tokenStatement(channel: Channel, token: Sealed, expiresAt: string | null): Statement {
    return this.db.statement(
      "UPDATE social_ai_channels SET token_ciphertext = ?, token_nonce = ?, token_auth_tag = ?, key_version = ?, token_expires_at = ?, status = 'connected', last_error = NULL, last_error_at = NULL WHERE channel = ?",
      token.ciphertext, token.nonce, token.authTag, token.keyVersion, expiresAt, channel);
  }

  async stats(channel: Channel, dayStart: string): Promise<ChannelStats> {
    const r = await this.db.first<{ inbound: number; replies: number; handoffs: number }>(
      `SELECT (SELECT count(*) FROM social_ai_messages WHERE channel = ? AND direction = 'in' AND created_at >= ?) AS inbound,
              (SELECT count(*) FROM social_ai_messages WHERE channel = ? AND direction = 'out' AND status = 'sent' AND created_at >= ?) AS replies,
              (SELECT count(*) FROM social_ai_conversations WHERE channel = ? AND status = 'handoff') AS handoffs`,
      channel, dayStart, channel, dayStart, channel,
    );
    const failures = await this.db.all<{ id: string; conversation_id: string; created_at: string; status: MessageStatus; error: string | null }>(
      "SELECT id, conversation_id, created_at, status, error FROM social_ai_messages WHERE channel = ? AND status IN ('failed','blocked') ORDER BY created_at DESC LIMIT 5", channel);
    return {
      inboundToday: r?.inbound ?? 0, repliesToday: r?.replies ?? 0, handoffsOpen: r?.handoffs ?? 0,
      failures: failures.map((f) => ({ id: f.id, conversationId: f.conversation_id, at: f.created_at, status: f.status, error: f.error })),
    };
  }

  // --- settings -------------------------------------------------------------------------------------------------
  async settings(): Promise<BotSettingsView> {
    const r = await this.db.first<SettingsRow>("SELECT s.*, (SELECT u.display_name FROM users u WHERE u.id = s.updated_by) AS updated_by_name FROM social_ai_settings s WHERE s.id = 1");
    const hours = parse<Partial<WorkingHours>>(r?.hours_json ?? null, {});
    return {
      tone: r?.tone ?? "friendly", toneNote: r?.tone_note ?? "", welcomeMessage: r?.welcome_message ?? "", rulesText: r?.rules_text ?? "", bansText: r?.bans_text ?? "",
      examples: parse<BotExample[]>(r?.examples_json ?? null, []).filter((e) => e && typeof e.question === "string" && typeof e.answer === "string"),
      hoursEnabled: r?.hours_enabled === 1,
      hours: {
        days: Array.isArray(hours.days) ? hours.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) : DEFAULT_HOURS.days,
        from: typeof hours.from === "string" && isClock(hours.from) ? hours.from : DEFAULT_HOURS.from, to: typeof hours.to === "string" && isClock(hours.to) ? hours.to : DEFAULT_HOURS.to,
      },
      offHoursMessage: r?.off_hours_message ?? "", handoffRules: r?.handoff_rules ?? "", conversationLimit: r?.conversation_limit ?? 40, dailyLimit: r?.daily_limit ?? 1000,
      updatedAt: r?.updated_at ?? "", updatedByName: r?.updated_by_name ?? null,
    };
  }

  saveSettingsStatement(s: BotSettings, actorId: string, now: string, expectedUpdatedAt: string): Statement {
    return this.db.statement(
      `UPDATE social_ai_settings SET tone = ?, tone_note = ?, welcome_message = ?, rules_text = ?, bans_text = ?, examples_json = ?, hours_enabled = ?, hours_json = ?, off_hours_message = ?,
              handoff_rules = ?, conversation_limit = ?, daily_limit = ?, updated_by = ?, updated_at = ? WHERE id = 1 AND updated_at = ?`,
      s.tone, s.toneNote, s.welcomeMessage, s.rulesText, s.bansText, JSON.stringify(s.examples), s.hoursEnabled ? 1 : 0, JSON.stringify(s.hours), s.offHoursMessage, s.handoffRules,
      s.conversationLimit, s.dailyLimit, actorId, now, expectedUpdatedAt,
    );
  }

  // --- referral maps --------------------------------------------------------------------------------------------
  private mapOf = (r: { id: string; source_type: ReferralType; source_id: string; label: string; product_ids_json: string; extra_prompt: string; is_active: number; updated_at: string }): ReferralMap => ({
    id: r.id, sourceType: r.source_type, sourceId: r.source_id, label: r.label, productIds: parse<string[]>(r.product_ids_json, []), extraPrompt: r.extra_prompt, isActive: r.is_active === 1, updatedAt: r.updated_at,
  });

  async referralMaps(): Promise<ReferralMap[]> {
    return (await this.db.all<Parameters<typeof this.mapOf>[0]>("SELECT * FROM social_ai_referral_maps ORDER BY created_at DESC")).map(this.mapOf);
  }

  async referralMap(id: string): Promise<ReferralMap | null> {
    const r = await this.db.first<Parameters<typeof this.mapOf>[0]>("SELECT * FROM social_ai_referral_maps WHERE id = ?", id);
    return r ? this.mapOf(r) : null;
  }

  /** The active mapping of an ad / post id or a ref code (ids are unique across types in practice; type breaks ties). */
  async referralMapFor(keys: string[], type: ReferralType): Promise<ReferralMap | null> {
    const ids = [...new Set(keys.filter(Boolean))].slice(0, 4);
    if (!ids.length) return null;
    const r = await this.db.first<Parameters<typeof this.mapOf>[0]>(
      `SELECT * FROM social_ai_referral_maps WHERE is_active = 1 AND source_id IN (${placeholders(ids.length)}) ORDER BY (source_type = ?) DESC LIMIT 1`, ...ids, type);
    return r ? this.mapOf(r) : null;
  }

  async referralSourceTaken(type: ReferralType, sourceId: string, exceptId: string | null): Promise<boolean> {
    return !!(await this.db.first("SELECT 1 AS x FROM social_ai_referral_maps WHERE source_type = ? AND source_id = ? AND id <> ?", type, sourceId, exceptId ?? ""));
  }

  insertReferralStatement(m: ReferralMap, now: string): Statement {
    return this.db.statement(
      "INSERT INTO social_ai_referral_maps (id, source_type, source_id, label, product_ids_json, extra_prompt, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      m.id, m.sourceType, m.sourceId, m.label, JSON.stringify(m.productIds), m.extraPrompt, m.isActive ? 1 : 0, now, now);
  }

  updateReferralStatement(m: ReferralMap, now: string, expectedUpdatedAt: string): Statement {
    return this.db.statement(
      "UPDATE social_ai_referral_maps SET source_type = ?, source_id = ?, label = ?, product_ids_json = ?, extra_prompt = ?, is_active = ?, updated_at = ? WHERE id = ? AND updated_at = ?",
      m.sourceType, m.sourceId, m.label, JSON.stringify(m.productIds), m.extraPrompt, m.isActive ? 1 : 0, now, m.id, expectedUpdatedAt);
  }

  deleteReferralStatement(id: string): Statement {
    return this.db.statement("DELETE FROM social_ai_referral_maps WHERE id = ?", id);
  }

  // --- conversations --------------------------------------------------------------------------------------------
  async conversation(id: string): Promise<StoredConversation | null> {
    const r = await this.db.first<ConversationRow>(`SELECT ${CONVERSATION_COLUMNS} FROM social_ai_conversations c WHERE c.id = ?`, id);
    return r ? toConversation(r) : null;
  }

  async conversationOf(channel: Channel, contactId: string): Promise<{ id: string; status: ConversationStatus } | null> {
    return this.db.first("SELECT id, status FROM social_ai_conversations WHERE channel = ? AND contact_id = ?", channel, contactId);
  }

  async messageExists(channel: Channel, externalId: string): Promise<boolean> {
    return !!(await this.db.first("SELECT 1 AS x FROM social_ai_messages WHERE channel = ? AND external_id = ?", channel, externalId));
  }

  /**
   * One inbound message: the conversation is created or refreshed (a closed one reopens with the bot; a handed-off one
   * stays with staff and counts as unread) and the message is stored. UNIQUE (channel, external_id) aborts the whole
   * batch when the same webhook is delivered twice at once.
   */
  inboundStatements(p: { conversationId: string; messageId: string; channel: Channel; contactId: string; contactName: string | null; externalId: string; text: string; at: string; referral: Referral | null; replyDueAt: string }): Statement[] {
    const referralJson = p.referral ? JSON.stringify(p.referral) : null;
    return [
      this.db.statement(
        `INSERT INTO social_ai_conversations (id, channel, contact_id, contact_name, status, referral_json, referral_source, last_inbound_at, last_message_at, last_preview, last_sender, reply_due_at, created_at)
         VALUES (?, ?, ?, ?, 'bot', ?, ?, ?, ?, ?, 'customer', ?, ?)
         ON CONFLICT (channel, contact_id) DO UPDATE SET
           contact_name = COALESCE(excluded.contact_name, contact_name),
           referral_json = COALESCE(excluded.referral_json, referral_json), referral_source = COALESCE(excluded.referral_source, referral_source),
           last_inbound_at = excluded.last_inbound_at, last_message_at = excluded.last_message_at, last_preview = excluded.last_preview, last_sender = 'customer',
           staff_unread = CASE WHEN status = 'handoff' THEN staff_unread + 1 ELSE 0 END,
           reply_due_at = CASE WHEN status = 'handoff' THEN NULL ELSE excluded.reply_due_at END,
           handoff_reason = CASE WHEN status = 'handoff' THEN handoff_reason ELSE NULL END,
           status = CASE WHEN status = 'closed' THEN 'bot' ELSE status END`,
        p.conversationId, p.channel, p.contactId, p.contactName, referralJson, p.referral?.sourceId ?? null, p.at, p.at, previewOf(p.text), p.replyDueAt, p.at,
      ),
      this.db.statement(
        `INSERT INTO social_ai_messages (id, conversation_id, channel, direction, sender, body, external_id, status, created_at)
         SELECT ?, c.id, ?, 'in', 'customer', ?, ?, 'received', ? FROM social_ai_conversations c WHERE c.channel = ? AND c.contact_id = ?`,
        p.messageId, p.channel, p.text, p.externalId, p.at, p.channel, p.contactId,
      ),
      this.db.statement("UPDATE social_ai_channels SET last_inbound_at = ? WHERE channel = ?", p.at, p.channel),
    ];
  }

  /** Conversations whose debounce has passed and that nobody is answering right now. */
  async dueConversations(now: string, limit: number): Promise<string[]> {
    return (await this.db.all<{ id: string }>(
      "SELECT id FROM social_ai_conversations WHERE status = 'bot' AND reply_due_at IS NOT NULL AND reply_due_at <= ? AND (locked_until IS NULL OR locked_until <= ?) ORDER BY reply_due_at LIMIT ?",
      now, now, limit)).map((r) => r.id);
  }

  /** Conditional claim (same idea as the outbox): two workers never answer the same conversation. */
  async claim(id: string, now: string, lockUntil: string): Promise<boolean> {
    const res = await this.db.run(
      "UPDATE social_ai_conversations SET locked_until = ? WHERE id = ? AND status = 'bot' AND reply_due_at IS NOT NULL AND reply_due_at <= ? AND (locked_until IS NULL OR locked_until <= ?)",
      lockUntil, id, now, now);
    return res.changes === 1;
  }

  /** Lets the conversation go; a customer message that arrived while the bot was thinking keeps it due. */
  releaseStatement(id: string, lockUntil: string, patch: { status?: ConversationStatus; handoffReason?: string | null; now: string; last?: { preview: string; sender: MessageSender }; retryAt?: string | null }): Statement {
    return this.db.statement(
      `UPDATE social_ai_conversations SET locked_until = NULL,
              reply_due_at = CASE WHEN ? IS NOT NULL THEN ?
                                  WHEN ? = 'bot' AND EXISTS (SELECT 1 FROM social_ai_messages m WHERE m.conversation_id = social_ai_conversations.id AND m.direction = 'in' AND m.handled_at IS NULL) THEN ?
                                  ELSE NULL END,
              status = ?, handoff_reason = ?, handoff_at = CASE WHEN ? = 'handoff' THEN ? ELSE handoff_at END,
              staff_unread = CASE WHEN ? = 'handoff' THEN staff_unread + 1 ELSE staff_unread END,
              last_message_at = COALESCE(?, last_message_at), last_preview = COALESCE(?, last_preview), last_sender = COALESCE(?, last_sender)
        WHERE id = ? AND locked_until = ?`,
      patch.retryAt ?? null, patch.retryAt ?? null, patch.status ?? "bot", patch.now, patch.status ?? "bot", patch.handoffReason ?? null, patch.status ?? "bot", patch.now, patch.status ?? "bot",
      patch.last ? patch.now : null, patch.last?.preview ?? null, patch.last?.sender ?? null, id, lockUntil,
    );
  }

  async pendingInbound(conversationId: string): Promise<StoredMessage[]> {
    return (await this.db.all<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM social_ai_messages m WHERE m.conversation_id = ? AND m.direction = 'in' AND m.handled_at IS NULL ORDER BY m.rowid`, conversationId)).map(toMessage);
  }

  markHandledStatements(ids: string[], now: string): Statement[] {
    return ids.map((id) => this.db.statement("UPDATE social_ai_messages SET handled_at = ? WHERE id = ? AND handled_at IS NULL", now, id));
  }

  /** Latest messages, oldest first. Insertion order (rowid) is the order things happened; timestamps can tie. */
  async history(conversationId: string, limit: number): Promise<StoredMessage[]> {
    return (await this.db.all<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS} FROM social_ai_messages m WHERE m.conversation_id = ? ORDER BY m.rowid DESC LIMIT ?`, conversationId, limit)).map(toMessage).reverse();
  }

  async message(id: string): Promise<StoredMessage | null> {
    const r = await this.db.first<MessageRow>(`SELECT ${MESSAGE_COLUMNS} FROM social_ai_messages m WHERE m.id = ?`, id);
    return r ? toMessage(r) : null;
  }

  async botReplyCounts(conversationId: string, since: string, dayStart: string): Promise<{ conversation: number; today: number }> {
    const r = await this.db.first<{ c: number; d: number }>(
      `SELECT (SELECT count(*) FROM social_ai_messages WHERE conversation_id = ? AND sender = 'bot' AND created_at >= ?) AS c,
              (SELECT count(*) FROM social_ai_messages WHERE sender = 'bot' AND created_at >= ?) AS d`, conversationId, since, dayStart);
    return { conversation: r?.c ?? 0, today: r?.d ?? 0 };
  }

  outboundStatement(m: { id: string; conversationId: string; channel: Channel; sender: "bot" | "staff"; authorId: string | null; body: string; humanAgent: boolean; at: string }): Statement {
    return this.db.statement(
      "INSERT INTO social_ai_messages (id, conversation_id, channel, direction, sender, author_id, body, status, human_agent, created_at) VALUES (?, ?, ?, 'out', ?, ?, ?, 'pending', ?, ?)",
      m.id, m.conversationId, m.channel, m.sender, m.authorId, m.body, m.humanAgent ? 1 : 0, m.at);
  }

  /** Retry job for a send that did not go through at once. `notBefore` keeps it behind the immediate attempt. */
  sendOutboxStatement(id: string, messageId: string, notBefore: string): Statement {
    return this.db.statement(
      "INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, next_attempt_at, dedupe_key) VALUES (?, 'social_ai_message', ?, 'social_ai.send', ?, ?, ?)",
      id, messageId, JSON.stringify({ messageId }), notBefore, `social_ai.send:${messageId}`);
  }

  toolCallStatement(t: { id: string; conversationId: string; messageId: string | null; name: string; input: unknown; outputPreview: string; ok: boolean; at: string }): Statement {
    return this.db.statement(
      "INSERT INTO social_ai_tool_calls (id, conversation_id, message_id, name, input_json, output_preview, ok, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      t.id, t.conversationId, t.messageId, t.name.slice(0, 60), JSON.stringify(t.input ?? {}), t.outputPreview.slice(0, 590), t.ok ? 1 : 0, t.at);
  }

  /** Only a message that is still waiting changes state (the immediate send and the outbox retry may race). */
  async settleMessage(id: string, status: "sent" | "failed" | "blocked", externalId: string | null, error: string | null): Promise<boolean> {
    const res = await this.db.run("UPDATE social_ai_messages SET status = ?, external_id = COALESCE(?, external_id), error = ? WHERE id = ? AND status = 'pending'", status, externalId, error?.slice(0, 290) ?? null, id);
    return res.changes === 1;
  }

  staffTouchStatement(id: string, patch: { status: ConversationStatus; reason?: string | null; now: string; last?: { preview: string; sender: MessageSender }; fromStatus?: ConversationStatus }): Statement {
    return this.db.statement(
      `UPDATE social_ai_conversations SET status = ?, handoff_reason = CASE WHEN ? = 'handoff' THEN COALESCE(?, handoff_reason) ELSE NULL END,
              handoff_at = CASE WHEN ? = 'handoff' AND status <> 'handoff' THEN ? ELSE handoff_at END, staff_unread = 0, locked_until = NULL,
              reply_due_at = CASE WHEN ? = 'bot' AND EXISTS (SELECT 1 FROM social_ai_messages m WHERE m.conversation_id = social_ai_conversations.id AND m.direction = 'in' AND m.handled_at IS NULL) THEN ? ELSE NULL END,
              last_message_at = COALESCE(?, last_message_at), last_preview = COALESCE(?, last_preview), last_sender = COALESCE(?, last_sender)
        WHERE id = ? AND (? IS NULL OR status = ?)`,
      patch.status, patch.status, patch.reason ?? null, patch.status, patch.now, patch.status, patch.now, patch.last ? patch.now : null, patch.last?.preview ?? null, patch.last?.sender ?? null,
      id, patch.fromStatus ?? null, patch.fromStatus ?? null,
    );
  }

  /** Messages the bot never answered are not answered later by surprise when staff give the conversation back. */
  skipPendingStatement(conversationId: string, now: string): Statement {
    return this.db.statement("UPDATE social_ai_messages SET handled_at = ? WHERE conversation_id = ? AND direction = 'in' AND handled_at IS NULL", now, conversationId);
  }

  markReadStatement(id: string): Statement {
    return this.db.statement("UPDATE social_ai_conversations SET staff_unread = 0 WHERE id = ?", id);
  }

  async list(f: ConversationFilter): Promise<{ rows: StoredConversation[]; total: number; counts: Record<ConversationStatus | "all", number>; sources: { id: string; label: string }[] }> {
    const where: string[] = ["1 = 1"];
    const params: unknown[] = [];
    if (f.channel) { where.push("c.channel = ?"); params.push(f.channel); }
    if (f.source) { where.push("c.referral_source = ?"); params.push(f.source); }
    if (f.from) { where.push("c.last_message_at >= ?"); params.push(f.from); }
    if (f.to) { where.push("c.last_message_at < ?"); params.push(f.to); }
    if (f.q) { where.push("(c.contact_name LIKE ? ESCAPE '\\' OR c.contact_id LIKE ? ESCAPE '\\' OR c.last_preview LIKE ? ESCAPE '\\')"); params.push(like(f.q), like(f.q), like(f.q)); }
    const base = where.join(" AND ");
    const withStatus = f.status ? `${base} AND c.status = ?` : base;
    const statusParams = f.status ? [...params, f.status] : params;
    const [rows, total, counts, sources] = await Promise.all([
      this.db.all<ConversationRow>(
        `SELECT ${CONVERSATION_COLUMNS} FROM social_ai_conversations c WHERE ${withStatus} ORDER BY (c.status = 'handoff' AND c.staff_unread > 0) DESC, c.last_message_at DESC LIMIT ? OFFSET ?`,
        ...statusParams, f.pageSize, (f.page - 1) * f.pageSize),
      this.db.first<{ n: number }>(`SELECT count(*) AS n FROM social_ai_conversations c WHERE ${withStatus}`, ...statusParams),
      this.db.all<{ status: ConversationStatus; n: number }>(`SELECT c.status, count(*) AS n FROM social_ai_conversations c WHERE ${base} GROUP BY c.status`, ...params),
      this.db.all<{ id: string; label: string | null }>(
        `SELECT c.referral_source AS id, (SELECT m.label FROM social_ai_referral_maps m WHERE m.source_id = c.referral_source LIMIT 1) AS label
           FROM social_ai_conversations c WHERE c.referral_source IS NOT NULL GROUP BY c.referral_source ORDER BY max(c.last_message_at) DESC LIMIT 50`),
    ]);
    const by = Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<ConversationStatus, number>>;
    const bot = by.bot ?? 0, handoff = by.handoff ?? 0, closed = by.closed ?? 0;
    return {
      rows: rows.map(toConversation), total: total?.n ?? 0, counts: { all: bot + handoff + closed, bot, handoff, closed },
      sources: sources.map((s) => ({ id: s.id, label: s.label ?? s.id })),
    };
  }

  async messages(conversationId: string, limit: number): Promise<StoredMessage[]> {
    return this.history(conversationId, limit);
  }

  async toolCalls(conversationId: string, limit: number): Promise<ToolCallView[]> {
    const rows = await this.db.all<{ id: string; message_id: string | null; name: string; input_json: string; output_preview: string; ok: number; created_at: string }>(
      "SELECT id, message_id, name, input_json, output_preview, ok, created_at FROM social_ai_tool_calls WHERE conversation_id = ? ORDER BY rowid DESC LIMIT ?", conversationId, limit);
    return rows.reverse().map((r) => ({ id: r.id, messageId: r.message_id, name: r.name, input: parse<Record<string, unknown>>(r.input_json, {}), outputPreview: r.output_preview, ok: r.ok === 1, createdAt: r.created_at }));
  }

  // --- retention ------------------------------------------------------------------------------------------------
  /**
   * Hard delete of everything older than `before`: tool calls, messages, then conversations left without a message
   * (their referral goes with them). Returns the statements; counts are read from the batch results.
   */
  retentionStatements(before: string): Statement[] {
    return [
      this.db.statement("DELETE FROM social_ai_tool_calls WHERE created_at < ?", before),
      this.db.statement("DELETE FROM social_ai_messages WHERE created_at < ?", before),
      this.db.statement(
        "DELETE FROM social_ai_conversations WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM social_ai_messages m WHERE m.conversation_id = social_ai_conversations.id)", before),
    ];
  }

  /** System job: no staff actor. Only row counts are recorded, never content. */
  systemAuditStatement(id: string, action: string, diff: Record<string, number>): Statement {
    return this.db.statement(
      "INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, diff_redacted_json, request_id) VALUES (?, NULL, ?, 'social_ai_conversation', NULL, ?, NULL)", id, action, JSON.stringify(diff));
  }

  /** Published products for the mapping picker. */
  productOptions(): Promise<{ id: string; name: string }[]> {
    return this.db.all("SELECT id, name FROM products WHERE status = 'published' ORDER BY name LIMIT 3000");
  }

  async productNames(ids: string[]): Promise<{ id: string; name: string }[]> {
    if (!ids.length) return [];
    const unique = [...new Set(ids)].slice(0, 80);
    return this.db.all<{ id: string; name: string }>(`SELECT id, name FROM products WHERE id IN (${placeholders(unique.length)})`, ...unique);
  }
}
