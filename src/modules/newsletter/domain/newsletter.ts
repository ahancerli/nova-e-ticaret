/**
 * E-bülten (pure; shared with the browser). Double opt-in: a sign-up is pending until the link in the confirmation
 * e-mail is used. Answers never tell whether an address is already on the list.
 */
export const SUBSCRIBER_STATUSES = { pending: "Onay bekliyor", subscribed: "Abone", unsubscribed: "Ayrıldı" } as const;
export type SubscriberStatus = keyof typeof SUBSCRIBER_STATUSES;
export const SUBSCRIBER_SOURCES = { footer: "Site altı formu", account: "Hesabım", panel: "Panel" } as const;
export type SubscriberSource = keyof typeof SUBSCRIBER_SOURCES;

/** Confirmation links expire after this; a later sign-up sends a new one. */
export const CONFIRM_HOURS = 48;
/** The same address gets at most one confirmation e-mail in this window (protects inboxes from form abuse). */
export const RESEND_MINUTES = 10;

export const SUBSCRIBER_TABS = { all: "Tümü", subscribed: "Abone", pending: "Onay bekliyor", unsubscribed: "Ayrıldı" } as const;
export type SubscriberTab = keyof typeof SUBSCRIBER_TABS;
export const SUBSCRIBER_SORTS = ["created_at", "email", "confirmed_at"] as const;
export type SubscriberSort = (typeof SUBSCRIBER_SORTS)[number];

/** The only answer of the sign-up endpoint (same for new, pending and existing addresses). */
export const SUBSCRIBE_MESSAGE = "Onay bağlantısını e-posta adresinize gönderdik. Aboneliğiniz, bağlantıya tıklayıp onayladığınızda başlar.";

export interface SubscriberRow {
  id: string;
  email: string;
  status: SubscriberStatus;
  source: SubscriberSource;
  isMember: boolean;
  memberName: string | null;
  createdAt: string;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
}

export interface SubscriberQuery {
  q?: string;
  tab: SubscriberTab;
  sort: SubscriberSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

/** "ayse.kaya@example.com" → "a***@example.com" (confirmation pages never echo the full address). */
export const maskAddress = (email: string) => {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}***@${domain}`;
};
