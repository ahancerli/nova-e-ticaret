/**
 * İYS (İleti Yönetim Sistemi) — pure rules. Commercial e-mail / SMS consents (and their withdrawal) are registered at
 * İYS; the brand may only message recipients whose consent İYS holds. Facts used here (İYS developer docs, checked
 * 2026-11-16 via dev.iys.org.tr examples and integrator libraries):
 *   POST {base}/oauth2/token  { username, password, grant_type: "password" } → access_token
 *   POST {base}/sps/{iysCode}/brands/{brandCode}/consents
 *        { consentDate: "YYYY-MM-DD HH:mm:ss" (Turkey time), source: "HS_WEB", recipient, recipientType: "BIREYSEL",
 *          status: "ONAY" | "RET", type: "EPOSTA" | "MESAJ" | "ARAMA" } → { transactionId, creationDate }
 *   GET  {base}/sps/{iysCode}/brands/{brandCode}/consents/changes?after=&limit= → { after, list } (pull; verify in sandbox)
 */

export const IYS_BASE_URL = { sandbox: "https://api.sandbox.iys.org.tr", production: "https://api.iys.org.tr" } as const;
export type IysEnvironment = keyof typeof IYS_BASE_URL;
export const IYS_ENVIRONMENTS: Record<IysEnvironment, string> = { sandbox: "Test (sandbox)", production: "Canlı" };

export type IysChannel = "EPOSTA" | "MESAJ";
export type IysStatus = "ONAY" | "RET";
export type IysQueueState = "pending" | "sent" | "failed" | "skipped";
export const IYS_CHANNEL_LABEL: Record<IysChannel, string> = { EPOSTA: "E-posta", MESAJ: "SMS" };
export const IYS_STATE_LABEL: Record<IysQueueState, string> = { pending: "Bekliyor", sent: "İYS'de", failed: "Reddedildi", skipped: "Gönderilmez" };

/** Consent purpose (user_consents) → İYS channel. */
export const CHANNEL_OF: Record<string, IysChannel | undefined> = { marketing_email: "EPOSTA", marketing_sms: "MESAJ" };

export const MAX_IYS_ATTEMPTS = 8;
export const IYS_BATCH = 50;
/** İYS rule: a consent is registered within 3 business days of being given. */
export const IYS_DEADLINE_BUSINESS_DAYS = 3;

/** Network / 5xx back-off: 1, 2, 4 … 60 minutes. */
export const iysRetryMinutes = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1));

/** UTC ISO → "YYYY-MM-DD HH:mm:ss" in Turkey time (UTC+3, no DST). */
export function iysDate(iso: string): string {
  return new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
}

/** İYS only knows Turkish mobiles: "+905XXXXXXXXX" from an E.164 number, else null (consent stays local). */
export function iysPhone(e164: string | null | undefined): string | null {
  const d = (e164 ?? "").replace(/[^\d+]/g, "");
  return /^\+905\d{9}$/.test(d) ? d : null;
}

export const iysEmail = (email: string | null | undefined) => {
  const e = (email ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
};

/** Recipient of a channel, or null when İYS cannot hold it. */
export const iysRecipient = (channel: IysChannel, contact: { email?: string | null; phone?: string | null }) =>
  channel === "EPOSTA" ? iysEmail(contact.email) : iysPhone(contact.phone);

export interface IysSettingsView {
  isActive: boolean;
  environment: IysEnvironment;
  iysCode: string | null;
  brandCode: string | null;
  username: string | null;
  passwordSet: boolean;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface IysQueueRow {
  id: string;
  channel: IysChannel;
  recipient: string;
  status: IysStatus;
  consentAt: string;
  state: IysQueueState;
  attempts: number;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface IysOverview {
  settings: IysSettingsView;
  counts: Record<IysQueueState, number>;
  /** Pending rows older than the 3 business day limit (approximated as 3 days + weekend). */
  overdue: number;
  recent: IysQueueRow[];
}

/** A consent change made directly at İYS (pulled back). */
export interface IysChange {
  recipient: string;
  type: string;
  status: IysStatus;
  consentDate: string | null;
  transactionId: string | null;
}

/** Masks a recipient for lists: a***@d***.com / +90532***67. */
export const maskRecipient = (r: string) =>
  r.includes("@") ? r.replace(/^(.).*(@.)[^.]*(\..*)$/, "$1***$2***$3") : `${r.slice(0, 6)}***${r.slice(-2)}`;
