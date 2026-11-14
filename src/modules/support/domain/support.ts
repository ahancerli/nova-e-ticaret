/**
 * Live support (Canlı destek) — pure types and rules, safe for client components. A member opens a conversation from
 * the shop widget, staff answer from the panel. Every message gets the next `seq` of its conversation; clients
 * remember the last seq they saw and ask for `after=seq` when their live stream reconnects, so nothing is lost.
 */
export const SUPPORT_MESSAGE_MAX = 2000;
export const SUPPORT_PREVIEW_MAX = 120;
export const SUPPORT_PAGE_SIZE = 50;
export const SUPPORT_CLOSED_LIST = 50;

export type SupportSender = "customer" | "staff";
export type SupportStatus = "open" | "closed";
export const SUPPORT_STATUSES = ["open", "closed"] as const;

export interface SupportSettings {
  enabled: boolean;
  teamName: string;
  welcomeMessage: string;
  offlineMessage: string;
  updatedAt: string;
}

export interface SupportMessage {
  id: string;
  conversationId: string;
  seq: number;
  sender: SupportSender;
  /** Staff first name for customers, full name for staff; null when the author was deleted. */
  authorName: string | null;
  body: string;
  /** Sender's own key: lets the sending screen replace its optimistic bubble. */
  clientId: string;
  createdAt: string;
}

/** Panel inbox row (also pushed on every change). */
export interface SupportConversationSummary {
  id: string;
  customerId: string;
  customerName: string;
  status: SupportStatus;
  assigneeName: string | null;
  pagePath: string | null;
  lastSeq: number;
  lastMessageAt: string | null;
  lastPreview: string | null;
  lastSender: SupportSender | null;
  staffUnread: number;
  customerReadSeq: number;
  createdAt: string;
}

/** What the shop widget knows about the member's latest conversation. */
export interface CustomerConversation {
  id: string;
  status: SupportStatus;
  lastSeq: number;
  customerUnread: number;
  staffReadSeq: number;
}

export interface CustomerSupportState {
  conversation: CustomerConversation | null;
  messages: SupportMessage[];
  agentsOnline: boolean;
}

export interface StaffConversationDetail {
  conversation: SupportConversationSummary;
  messages: SupportMessage[];
  /** More messages exist before the first one returned. */
  hasMore: boolean;
}

/** Public widget config, read by the storefront layout (SSR). */
export interface PublicSupportConfig {
  enabled: boolean;
  teamName: string;
  welcomeMessage: string;
  offlineMessage: string;
}

/**
 * One live event. Customers receive message / read / typing / status / presence of their own conversations; staff
 * receive everything with the updated inbox row in `conversation`.
 */
export type SupportEventKind = "message" | "read" | "typing" | "status" | "presence";
export interface SupportEvent {
  kind: SupportEventKind;
  conversationId: string | null;
  message?: SupportMessage | null;
  conversation?: SupportConversationSummary | null;
  readSeq?: number | null;
  reader?: SupportSender | null;
  typing?: SupportSender | null;
  status?: SupportStatus | null;
  agentsOnline?: boolean | null;
}

/** Collapses whitespace runs inside lines and blank-line runs; keeps single line breaks. */
export function cleanMessage(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > SUPPORT_PREVIEW_MAX ? `${flat.slice(0, SUPPORT_PREVIEW_MAX - 1)}…` : flat;
}

/** Merges messages by seq (live events and resync pages may overlap or arrive out of order). */
export function mergeMessages(current: readonly SupportMessage[], incoming: readonly SupportMessage[]): SupportMessage[] {
  if (!incoming.length) return current as SupportMessage[];
  const bySeq = new Map(current.map((m) => [m.seq, m]));
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}
