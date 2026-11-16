/**
 * Son gezilenler — pure rules (no I/O). Rows live in `recent_views` keyed by a hash of the viewer: a member by user
 * id, a guest by a random first-party cookie id. Kept only with "functional" cookie consent.
 */

/** Guest browser id cookie (random UUID, HttpOnly). */
export const RECENT_COOKIE = "nova_rv";
export const RECENT_COOKIE_DAYS = 90;
/** Products remembered per viewer (older ones drop out). */
export const RECENT_KEEP = 30;
export const RECENT_SHOW = 16;
/** Views older than this are forgotten. */
export const RECENT_RETENTION_DAYS = 90;

export const isVisitorCookie = (v: string | null | undefined): v is string => !!v && /^[0-9a-f-]{36}$/.test(v);

/** Who is looking: member id, guest cookie id and the raw Cookie header (for the consent check). */
export interface Viewer {
  userId: string | null;
  visitorId: string | null;
  cookieHeader: string | null;
}
