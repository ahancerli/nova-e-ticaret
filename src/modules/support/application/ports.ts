import type { Statement } from "@/core";
import type {
  CustomerConversation, SupportConversationSummary, SupportEvent, SupportMessage, SupportSender, SupportSettings, SupportStatus,
} from "../domain/support";

export interface MessageWrite {
  id: string;
  conversationId: string;
  sender: SupportSender;
  authorId: string;
  body: string;
  clientId: string;
  now: string;
}

export interface SupportRepository {
  settings(): Promise<SupportSettings>;
  updateSettingsStatement(s: Omit<SupportSettings, "updatedAt">, expectedUpdatedAt: string, actorId: string, now: string): Statement;

  /** The member's latest conversation (open first, else the most recently closed). */
  latestOf(customerId: string): Promise<CustomerConversation | null>;
  openIdOf(customerId: string): Promise<string | null>;
  customerName(customerId: string): Promise<string | null>;
  summary(id: string): Promise<SupportConversationSummary | null>;
  inbox(status: SupportStatus, limit: number): Promise<SupportConversationSummary[]>;
  /** Messages with seq > after (ascending), or the last `limit` before `before`. */
  messages(conversationId: string, q: { after?: number; before?: number; limit: number }, audience: SupportSender): Promise<SupportMessage[]>;
  message(id: string, audience: SupportSender): Promise<SupportMessage | null>;
  messageByClientId(conversationId: string, clientId: string): Promise<{ id: string } | null>;

  createStatement(id: string, customerId: string, pagePath: string | null, now: string): Statement;
  /** Counters + preview; guarded on `status = 'open'` (0 rows = closed meanwhile). Must precede insertMessageStatement. */
  bumpStatement(w: MessageWrite, preview: string): Statement;
  /** Takes seq = conversation.last_seq (already bumped in the same batch). */
  insertMessageStatement(w: MessageWrite): Statement;
  readStatement(conversationId: string, reader: SupportSender, seq: number): Statement;
  statusStatement(conversationId: string, from: SupportStatus, to: SupportStatus, actorId: string, now: string): Statement;
}

/**
 * Live fan-out of support events. In-process (one Node server); events are published after the transaction commits
 * and are never the source of truth — clients resync from the database by seq after a reconnect.
 */
export interface SupportHub {
  publish(channels: string[], event: SupportEvent): void;
  /** Ends when `signal` aborts. A consumer that falls behind by too many events is closed (its client reconnects). */
  subscribe(channels: string[], signal: AbortSignal): AsyncGenerator<SupportEvent, void, void>;
  /** Staff panels currently holding an inbox stream. */
  agentsOnline(): boolean;
}

export const STAFF_CHANNEL = "staff";
export const PRESENCE_CHANNEL = "presence";
export const customerChannel = (customerId: string) => `customer:${customerId}`;
