import { Repository, bit, bool, type Statement } from "@/core";
import type { MessageWrite, SupportRepository } from "../application/ports";
import type {
  CustomerConversation, SupportConversationSummary, SupportMessage, SupportSender, SupportSettings, SupportStatus,
} from "../domain/support";

const CUSTOMER_NAME = "COALESCE(NULLIF(trim(COALESCE(cp.first_name, '') || ' ' || COALESCE(cp.last_name, '')), ''), u.display_name)";
/** Customers see only the agent's first name. */
const FIRST_NAME = "CASE WHEN instr(a.display_name, ' ') > 0 THEN substr(a.display_name, 1, instr(a.display_name, ' ') - 1) ELSE a.display_name END";

const SUMMARY_SELECT = `
  SELECT c.id, c.customer_id, ${CUSTOMER_NAME} AS customer_name, c.status, a.display_name AS assignee_name,
         c.page_path, c.last_seq, c.last_message_at, c.last_preview, c.last_sender, c.staff_unread, c.customer_read_seq, c.created_at
    FROM support_conversations c JOIN users u ON u.id = c.customer_id
    LEFT JOIN customer_profiles cp ON cp.user_id = c.customer_id LEFT JOIN users a ON a.id = c.assigned_to`;

type SummaryRaw = {
  id: string; customer_id: string; customer_name: string; status: SupportStatus; assignee_name: string | null; page_path: string | null;
  last_seq: number; last_message_at: string | null; last_preview: string | null; last_sender: SupportSender | null; staff_unread: number;
  customer_read_seq: number; created_at: string;
};
const toSummary = (r: SummaryRaw): SupportConversationSummary => ({
  id: r.id, customerId: r.customer_id, customerName: r.customer_name, status: r.status, assigneeName: r.assignee_name,
  pagePath: r.page_path, lastSeq: r.last_seq, lastMessageAt: r.last_message_at, lastPreview: r.last_preview, lastSender: r.last_sender,
  staffUnread: r.staff_unread, customerReadSeq: r.customer_read_seq, createdAt: r.created_at,
});

type MessageRaw = { id: string; conversation_id: string; seq: number; sender: SupportSender; author_name: string | null; body: string; client_id: string; created_at: string };
const toMessage = (r: MessageRaw): SupportMessage => ({
  id: r.id, conversationId: r.conversation_id, seq: r.seq, sender: r.sender, authorName: r.author_name, body: r.body, clientId: r.client_id, createdAt: r.created_at,
});
/** Customers see agents' first names and no name on their own messages; staff see full names. */
const messageSelect = (audience: SupportSender) => `
  SELECT m.id, m.conversation_id, m.seq, m.sender, ${audience === "customer" ? `CASE WHEN m.sender = 'staff' THEN ${FIRST_NAME} END` : "a.display_name"} AS author_name,
         m.body, m.client_id, m.created_at
    FROM support_messages m LEFT JOIN users a ON a.id = m.author_id`;

export class D1SupportRepository extends Repository implements SupportRepository {
  async settings(): Promise<SupportSettings> {
    const r = await this.db.first<{ enabled: number; team_name: string; welcome_message: string; offline_message: string; updated_at: string }>(
      "SELECT enabled, team_name, welcome_message, offline_message, updated_at FROM support_settings WHERE id = 1",
    );
    if (!r) return { enabled: false, teamName: "Müşteri hizmetleri", welcomeMessage: "", offlineMessage: "", updatedAt: "" };
    return { enabled: bool(r.enabled), teamName: r.team_name, welcomeMessage: r.welcome_message, offlineMessage: r.offline_message, updatedAt: r.updated_at };
  }

  updateSettingsStatement(s: Omit<SupportSettings, "updatedAt">, expectedUpdatedAt: string, actorId: string, now: string): Statement {
    return this.db.statement(
      `UPDATE support_settings SET enabled = ?, team_name = ?, welcome_message = ?, offline_message = ?, updated_by = ?, updated_at = ?
        WHERE id = 1 AND updated_at = ?`,
      bit(s.enabled), s.teamName, s.welcomeMessage, s.offlineMessage, actorId, now, expectedUpdatedAt,
    );
  }

  async latestOf(customerId: string): Promise<CustomerConversation | null> {
    const r = await this.db.first<{ id: string; status: SupportStatus; last_seq: number; customer_unread: number; staff_read_seq: number }>(
      `SELECT id, status, last_seq, customer_unread, staff_read_seq FROM support_conversations
        WHERE customer_id = ? ORDER BY status = 'open' DESC, created_at DESC LIMIT 1`,
      customerId,
    );
    return r ? { id: r.id, status: r.status, lastSeq: r.last_seq, customerUnread: r.customer_unread, staffReadSeq: r.staff_read_seq } : null;
  }

  async openIdOf(customerId: string): Promise<string | null> {
    const r = await this.db.first<{ id: string }>("SELECT id FROM support_conversations WHERE customer_id = ? AND status = 'open'", customerId);
    return r?.id ?? null;
  }

  async customerName(customerId: string): Promise<string | null> {
    const r = await this.db.first<{ name: string }>(
      `SELECT ${CUSTOMER_NAME} AS name FROM users u LEFT JOIN customer_profiles cp ON cp.user_id = u.id WHERE u.id = ?`, customerId,
    );
    return r?.name ?? null;
  }

  async summary(id: string): Promise<SupportConversationSummary | null> {
    const r = await this.db.first<SummaryRaw>(`${SUMMARY_SELECT} WHERE c.id = ?`, id);
    return r ? toSummary(r) : null;
  }

  async inbox(status: SupportStatus, limit: number): Promise<SupportConversationSummary[]> {
    const rows = await this.db.all<SummaryRaw>(`${SUMMARY_SELECT} WHERE c.status = ? ORDER BY c.last_message_at DESC LIMIT ?`, status, limit);
    return rows.map(toSummary);
  }

  async messages(conversationId: string, q: { after?: number; before?: number; limit: number }, audience: SupportSender): Promise<SupportMessage[]> {
    if (q.after !== undefined) {
      const rows = await this.db.all<MessageRaw>(`${messageSelect(audience)} WHERE m.conversation_id = ? AND m.seq > ? ORDER BY m.seq LIMIT ?`, conversationId, q.after, q.limit);
      return rows.map(toMessage);
    }
    const rows = await this.db.all<MessageRaw>(
      `${messageSelect(audience)} WHERE m.conversation_id = ? AND m.seq < ? ORDER BY m.seq DESC LIMIT ?`,
      conversationId, q.before ?? Number.MAX_SAFE_INTEGER, q.limit,
    );
    return rows.reverse().map(toMessage);
  }

  async message(id: string, audience: SupportSender): Promise<SupportMessage | null> {
    const r = await this.db.first<MessageRaw>(`${messageSelect(audience)} WHERE m.id = ?`, id);
    return r ? toMessage(r) : null;
  }

  messageByClientId(conversationId: string, clientId: string): Promise<{ id: string } | null> {
    return this.db.first<{ id: string }>("SELECT id FROM support_messages WHERE conversation_id = ? AND client_id = ?", conversationId, clientId);
  }

  createStatement(id: string, customerId: string, pagePath: string | null, now: string): Statement {
    return this.db.statement(
      "INSERT INTO support_conversations (id, customer_id, page_path, last_message_at, created_at) VALUES (?, ?, ?, ?, ?)",
      id, customerId, pagePath, now, now,
    );
  }

  bumpStatement(w: MessageWrite, preview: string): Statement {
    // Writing implies having read everything before: the writer's own unread counter resets.
    const counters = w.sender === "staff"
      ? "staff_unread = 0, staff_read_seq = last_seq + 1, customer_unread = customer_unread + 1, assigned_to = COALESCE(assigned_to, ?)"
      : "customer_unread = 0, customer_read_seq = last_seq + 1, staff_unread = staff_unread + 1";
    return this.db.statement(
      `UPDATE support_conversations SET last_seq = last_seq + 1, last_message_at = ?, last_preview = ?, last_sender = ?, ${counters}
        WHERE id = ? AND status = 'open'`,
      w.now, preview, w.sender, ...(w.sender === "staff" ? [w.authorId] : []), w.conversationId,
    );
  }

  insertMessageStatement(w: MessageWrite): Statement {
    return this.db.statement(
      `INSERT INTO support_messages (id, conversation_id, seq, sender, author_id, body, client_id, created_at)
       SELECT ?, id, last_seq, ?, ?, ?, ?, ? FROM support_conversations WHERE id = ?`,
      w.id, w.sender, w.authorId, w.body, w.clientId, w.now, w.conversationId,
    );
  }

  readStatement(conversationId: string, reader: SupportSender, seq: number): Statement {
    const [readCol, unreadCol, counted] = reader === "staff"
      ? ["staff_read_seq", "staff_unread", "customer"] as const
      : ["customer_read_seq", "customer_unread", "staff"] as const;
    return this.db.statement(
      `UPDATE support_conversations SET ${readCol} = max(${readCol}, min(?, last_seq)),
              ${unreadCol} = (SELECT count(*) FROM support_messages m WHERE m.conversation_id = support_conversations.id AND m.sender = '${counted}'
                                 AND m.seq > max(support_conversations.${readCol}, min(?, support_conversations.last_seq)))
        WHERE id = ?`,
      seq, seq, conversationId,
    );
  }

  statusStatement(conversationId: string, from: SupportStatus, to: SupportStatus, actorId: string, now: string): Statement {
    return to === "closed"
      ? this.db.statement("UPDATE support_conversations SET status = 'closed', closed_by = ?, closed_at = ? WHERE id = ? AND status = ?", actorId, now, conversationId, from)
      : this.db.statement("UPDATE support_conversations SET status = 'open', closed_by = NULL, closed_at = NULL WHERE id = ? AND status = ?", conversationId, from);
  }
}
