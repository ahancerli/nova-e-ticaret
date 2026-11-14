import { UnitOfWork, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { NotificationPublisher } from "@/modules/notifications";
import type { Actor } from "@/modules/shared/actor";
import { SupportErrors } from "../domain/errors";
import {
  SUPPORT_CLOSED_LIST, SUPPORT_PAGE_SIZE, cleanMessage, previewOf,
  type CustomerConversation, type CustomerSupportState, type PublicSupportConfig, type StaffConversationDetail, type SupportConversationSummary, type SupportMessage,
  type SupportSender, type SupportSettings, type SupportStatus,
} from "../domain/support";
import { STAFF_CHANNEL, customerChannel, type MessageWrite, type SupportHub, type SupportRepository } from "./ports";

export interface SupportDeps {
  db: Database;
  support: SupportRepository;
  hub: SupportHub;
  notifications: NotificationPublisher;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
}

const RESYNC_LIMIT = 200;
const WAITING = "support.waiting" as const;
const conversationHref = (id: string) => `/admin/canli-destek?konusma=${id}`;

/** A customer must never see staff-only data (assignee, inbox counters): their events carry no inbox row. */
const forCustomer = (m: SupportMessage): SupportMessage => (m.sender === "customer" ? { ...m, authorName: null } : m);

/**
 * Shared write path: bump the conversation counters (guarded on open), insert the message with the new seq, then fan
 * out after commit. A retried request (same clientId) returns the stored message instead of writing twice.
 */
async function writeMessage(
  deps: SupportDeps, conversationId: string, sender: SupportSender, body: string, clientId: string, actor: Actor,
  extra: (uow: UnitOfWork) => Promise<void> = async () => {},
  create?: { customerId: string; pagePath: string | null },
): Promise<SupportMessage> {
  const { support } = deps;
  const text = cleanMessage(body);
  if (!text) throw SupportErrors.empty();
  if (!create) {
    const dup = await support.messageByClientId(conversationId, clientId);
    if (dup) return (await support.message(dup.id, sender))!;
  }
  const now = deps.clock.nowIso();
  const w: MessageWrite = { id: deps.ids.newId(), conversationId, sender, authorId: actor.userId, body: text, clientId, now };
  const uow = new UnitOfWork(deps.db);
  if (create) uow.add(support.createStatement(conversationId, create.customerId, create.pagePath, now));
  uow.add(support.bumpStatement(w, previewOf(text))).expectChanges(1, SupportErrors.closed).add(support.insertMessageStatement(w));
  await extra(uow);
  await uow.commit();

  const [message, summary] = await Promise.all([support.message(w.id, "staff"), support.summary(conversationId)]);
  if (!message || !summary) throw SupportErrors.notFound();
  deps.hub.publish([STAFF_CHANNEL], { kind: "message", conversationId, message, conversation: summary });
  const customerView = sender === "customer" ? forCustomer(message) : (await support.message(w.id, "customer"))!;
  deps.hub.publish([customerChannel(summary.customerId)], { kind: "message", conversationId, message: customerView });
  return sender === "customer" ? customerView : message;
}

// --- settings ----------------------------------------------------------------------------------------

export class GetSupportSettings {
  constructor(private readonly support: SupportRepository) {}
  execute(): Promise<SupportSettings> { return this.support.settings(); }
}

/** Query: widget config for the storefront layout (SSR, every page). */
export class GetPublicSupportConfig {
  constructor(private readonly support: SupportRepository) {}
  async execute(): Promise<PublicSupportConfig> {
    const { enabled, teamName, welcomeMessage, offlineMessage } = await this.support.settings();
    return { enabled, teamName, welcomeMessage, offlineMessage };
  }
}

export interface SupportSettingsInput {
  enabled: boolean;
  teamName: string;
  welcomeMessage: string;
  offlineMessage: string;
  expectedUpdatedAt: string;
}

export class UpdateSupportSettings {
  constructor(private readonly deps: SupportDeps) {}

  async execute(input: SupportSettingsInput, actor: Actor): Promise<SupportSettings> {
    const { expectedUpdatedAt, ...s } = input;
    const clean = { enabled: s.enabled, teamName: s.teamName.trim(), welcomeMessage: cleanMessage(s.welcomeMessage), offlineMessage: cleanMessage(s.offlineMessage) };
    await new UnitOfWork(this.deps.db)
      .add(this.deps.support.updateSettingsStatement(clean, expectedUpdatedAt, actor.userId, this.deps.clock.nowIso()))
      .expectChanges(1, SupportErrors.changedMeanwhile)
      .add(this.deps.audit.recordStatement({ actor, action: "support_settings.update", entityType: "support_settings", entityId: "1", diff: clean }))
      .commit();
    return this.deps.support.settings();
  }
}

// --- customer ----------------------------------------------------------------------------------------

/** Query: the member's latest conversation with its last page of messages (or only those after `after`). */
export class GetCustomerSupport {
  constructor(private readonly support: SupportRepository, private readonly hub: SupportHub) {}

  async execute(customerId: string, after?: number): Promise<CustomerSupportState> {
    const conversation = await this.support.latestOf(customerId);
    const messages = conversation
      ? await this.support.messages(conversation.id, after !== undefined ? { after, limit: RESYNC_LIMIT } : { limit: SUPPORT_PAGE_SIZE }, "customer")
      : [];
    return { conversation, messages, agentsOnline: this.hub.agentsOnline() };
  }
}

/** Query: the widget badge for the storefront layout (one indexed row, no messages). */
export class GetCustomerSupportBadge {
  constructor(private readonly support: SupportRepository) {}
  execute(customerId: string): Promise<CustomerConversation | null> { return this.support.latestOf(customerId); }
}

/**
 * Command: a member writes. Without an open conversation a new one starts (panel notification in the same
 * transaction); a closed conversation is never reopened by the customer.
 */
export class SendCustomerMessage {
  constructor(private readonly deps: SupportDeps) {}

  async execute(input: { body: string; clientId: string; pagePath?: string | null }, actor: Actor, retried = false): Promise<SupportMessage> {
    const { support } = this.deps;
    if (!(await support.settings()).enabled) throw SupportErrors.disabled();
    const openId = await support.openIdOf(actor.userId);
    if (openId) return writeMessage(this.deps, openId, "customer", input.body, input.clientId, actor);

    const id = this.deps.ids.newId();
    const notify = async (uow: UnitOfWork) => {
      const name = (await support.customerName(actor.userId)) ?? "Müşteri";
      uow.add(...await this.deps.notifications.statements({
        type: WAITING, title: `${name} canlı destekten yazdı`, body: previewOf(cleanMessage(input.body)), href: conversationHref(id),
        entityType: "support_conversation", entityId: id, dedupeKey: `${WAITING}:${id}`,
      }));
    };
    try {
      return await writeMessage(this.deps, id, "customer", input.body, input.clientId, actor, notify, { customerId: actor.userId, pagePath: input.pagePath ?? null });
    } catch (e) {
      // two tabs started a conversation at the same moment: the other one won, write into it
      if (!retried && /UNIQUE constraint failed: support_conversations\.customer_id/.test(String((e as Error)?.message))) return this.execute(input, actor, true);
      throw e;
    }
  }
}

async function ownConversation(support: SupportRepository, id: string, customerId: string): Promise<SupportConversationSummary> {
  const c = await support.summary(id);
  if (!c || c.customerId !== customerId) throw SupportErrors.notFound();
  return c;
}

export class MarkCustomerRead {
  constructor(private readonly deps: SupportDeps) {}

  async execute(conversationId: string, seq: number, actor: Actor): Promise<{ customerUnread: 0 }> {
    await ownConversation(this.deps.support, conversationId, actor.userId);
    await new UnitOfWork(this.deps.db).add(this.deps.support.readStatement(conversationId, "customer", seq)).commit();
    const summary = await this.deps.support.summary(conversationId);
    if (summary) this.deps.hub.publish([STAFF_CHANNEL], { kind: "read", conversationId, reader: "customer", readSeq: summary.customerReadSeq, conversation: summary });
    return { customerUnread: 0 };
  }
}

/** Typing signals are not stored; the route rate-limits them and the client sends at most one every few seconds. */
export class SignalCustomerTyping {
  constructor(private readonly support: SupportRepository, private readonly hub: SupportHub) {}

  async execute(conversationId: string, actor: Actor): Promise<{ sent: boolean }> {
    const c = await ownConversation(this.support, conversationId, actor.userId);
    if (c.status !== "open") return { sent: false };
    this.hub.publish([STAFF_CHANNEL], { kind: "typing", conversationId, typing: "customer" });
    return { sent: true };
  }
}

// --- staff -------------------------------------------------------------------------------------------

/** Query: all open conversations (newest activity first) or the most recent closed ones. */
export class ListSupportInbox {
  constructor(private readonly support: SupportRepository) {}
  execute(status: SupportStatus): Promise<SupportConversationSummary[]> {
    return this.support.inbox(status, status === "open" ? 500 : SUPPORT_CLOSED_LIST);
  }
}

export class GetStaffConversation {
  constructor(private readonly support: SupportRepository) {}

  async execute(id: string, q: { after?: number; before?: number }): Promise<StaffConversationDetail> {
    const conversation = await this.support.summary(id);
    if (!conversation) throw SupportErrors.notFound();
    const limit = q.after !== undefined ? RESYNC_LIMIT : SUPPORT_PAGE_SIZE;
    const messages = await this.support.messages(id, { ...q, limit }, "staff");
    const hasMore = q.after === undefined && messages.length === limit && (messages[0]?.seq ?? 1) > 1;
    return { conversation, messages, hasMore };
  }
}

/** Command: an agent answers. The first answer assigns the conversation and clears its "waiting" notification. */
export class SendStaffMessage {
  constructor(private readonly deps: SupportDeps) {}

  async execute(conversationId: string, input: { body: string; clientId: string }, actor: Actor): Promise<SupportMessage> {
    if (!(await this.deps.support.summary(conversationId))) throw SupportErrors.notFound();
    return writeMessage(this.deps, conversationId, "staff", input.body, input.clientId, actor, async (uow) => {
      uow.add(this.deps.notifications.dismissStatement(WAITING, "support_conversation", [conversationId]));
    });
  }
}

export class MarkStaffRead {
  constructor(private readonly deps: SupportDeps) {}

  async execute(conversationId: string, seq: number): Promise<SupportConversationSummary> {
    if (!(await this.deps.support.summary(conversationId))) throw SupportErrors.notFound();
    await new UnitOfWork(this.deps.db).add(this.deps.support.readStatement(conversationId, "staff", seq)).commit();
    const summary = (await this.deps.support.summary(conversationId))!;
    // other agents' badges follow; the customer gets "Görüldü"
    this.deps.hub.publish([STAFF_CHANNEL], { kind: "read", conversationId, reader: "staff", readSeq: seq, conversation: summary });
    this.deps.hub.publish([customerChannel(summary.customerId)], { kind: "read", conversationId, reader: "staff", readSeq: Math.min(seq, summary.lastSeq) });
    return summary;
  }
}

export class SignalStaffTyping {
  constructor(private readonly support: SupportRepository, private readonly hub: SupportHub) {}

  async execute(conversationId: string): Promise<{ sent: boolean }> {
    const c = await this.support.summary(conversationId);
    if (!c) throw SupportErrors.notFound();
    if (c.status !== "open") return { sent: false };
    this.hub.publish([customerChannel(c.customerId)], { kind: "typing", conversationId, typing: "staff" });
    return { sent: true };
  }
}

/** Command: close / reopen. Reopening fails while the customer already started a newer conversation. */
export class SetSupportStatus {
  constructor(private readonly deps: SupportDeps) {}

  async execute(conversationId: string, status: SupportStatus, actor: Actor): Promise<SupportConversationSummary> {
    const { support } = this.deps;
    const current = await support.summary(conversationId);
    if (!current) throw SupportErrors.notFound();
    if (current.status === status) return current;
    if (status === "open" && (await support.openIdOf(current.customerId))) throw SupportErrors.customerHasOpen();
    const uow = new UnitOfWork(this.deps.db)
      .add(support.statusStatement(conversationId, current.status, status, actor.userId, this.deps.clock.nowIso()))
      .expectChanges(1, SupportErrors.statusChanged)
      .add(this.deps.audit.recordStatement({
        actor, action: status === "closed" ? "support.close" : "support.reopen", entityType: "support_conversation", entityId: conversationId,
        diff: { customer: current.customerName },
      }));
    if (status === "closed") uow.add(this.deps.notifications.dismissStatement(WAITING, "support_conversation", [conversationId]));
    await uow.commit();
    const summary = (await support.summary(conversationId))!;
    this.deps.hub.publish([STAFF_CHANNEL], { kind: "status", conversationId, status, conversation: summary });
    this.deps.hub.publish([customerChannel(summary.customerId)], { kind: "status", conversationId, status });
    return summary;
  }
}
