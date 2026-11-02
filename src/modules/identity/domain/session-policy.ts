import type { Audience } from "@/core";

/**
 * Per-audience session rules (Strategy). Storefront and admin sessions are separate cookies with
 * different lifetimes; the admin cookie is SameSite=Strict because it is never needed cross-site.
 */
export interface SessionPolicy {
  audience: Audience;
  /** Cookie written at login. */
  cookie: string;
  /** Cookies accepted when reading (the first one present wins) and cleared at logout. */
  readCookies: readonly string[];
  ttlMinutes: number;
  sameSite: "lax" | "strict";
  /**
   * Which accounts may sign in. Staff and customer accounts are kept apart (as in Shopify): staff use the panel
   * only, and a staff member who wants to shop uses a separate customer account (different e-mail).
   */
  accounts: "staff" | "customer";
}

export const LEGACY_SESSION_COOKIE = "__Host-nova_session";
export const STOREFRONT_SESSION_COOKIE = "__Host-nova_store_session";
export const ADMIN_SESSION_COOKIE = "__Host-nova_admin_session";

export const SESSION_POLICIES: Record<Audience, SessionPolicy> = {
  storefront: {
    audience: "storefront",
    cookie: STOREFRONT_SESSION_COOKIE,
    readCookies: [STOREFRONT_SESSION_COOKIE, LEGACY_SESSION_COOKIE],
    ttlMinutes: 60 * 24 * 7,
    sameSite: "lax",
    accounts: "customer",
  },
  admin: {
    audience: "admin",
    cookie: ADMIN_SESSION_COOKIE,
    readCookies: [ADMIN_SESSION_COOKIE],
    ttlMinutes: 60 * 8,
    sameSite: "strict",
    accounts: "staff",
  },
};

/**
 * Brute-force limits.
 *  - Per IP: 5 failed logins per minute per endpoint (spec R-security).
 *  - Per (account, IP): 10 failures in 15 minutes block THAT IP for that account. Locking the account
 *    globally would let anyone lock an admin out by typing wrong passwords; this way only the attacker's
 *    address is shut out while the owner can still sign in from elsewhere.
 */
export const LOGIN_LIMITS = {
  perIp: { limit: 5, windowSec: 60 },
  perAccountAndIp: { limit: 10, windowSec: 15 * 60 },
} as const;
