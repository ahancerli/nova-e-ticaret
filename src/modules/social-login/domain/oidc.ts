/**
 * OpenID Connect building blocks (authorization code flow + PKCE) — pure: no network, no clock of its own.
 * The HTTP side (token exchange, signing keys) is `infrastructure/http-oidc-client.ts`.
 */
import type { SocialProfile, SocialProvider } from "./social";

export interface OidcEndpoints {
  /** Accepted `iss` values of the ID token. */
  issuers: readonly string[];
  authorize: string;
  token: string;
  jwks: string;
  scope: string;
  /** Extra authorization parameters (e.g. always show the account chooser on shared computers). */
  authorizeParams: Readonly<Record<string, string>>;
}

export const OIDC_ENDPOINTS: Record<SocialProvider, OidcEndpoints> = {
  google: {
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
    scope: "openid email profile",
    authorizeParams: { prompt: "select_account" },
  },
};

const enc = new TextEncoder();

export function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? enc.encode(input) : input;
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64UrlDecode(input: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) return null;
  try {
    const s = atob(input.replaceAll("-", "+").replaceAll("_", "/"));
    const out = new Uint8Array(new ArrayBuffer(s.length));
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** PKCE S256: the challenge sent to the provider; the verifier stays in our cookie until the code is exchanged. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
}

export function authorizationUrl(provider: SocialProvider, p: { clientId: string; redirectUri: string; state: string; nonce: string; codeChallenge: string }): string {
  const ep = OIDC_ENDPOINTS[provider];
  const url = new URL(ep.authorize);
  url.search = new URLSearchParams({
    client_id: p.clientId, redirect_uri: p.redirectUri, response_type: "code", scope: ep.scope, state: p.state, nonce: p.nonce,
    code_challenge: p.codeChallenge, code_challenge_method: "S256", ...ep.authorizeParams,
  }).toString();
  return url.toString();
}

export interface DecodedJwt {
  header: { alg?: unknown; kid?: unknown };
  claims: Record<string, unknown>;
  /** `header.payload` bytes the signature covers. */
  signingInput: Uint8Array<ArrayBuffer>;
  signature: Uint8Array<ArrayBuffer>;
}

/** Splits a compact JWS; `null` for anything that is not three base64url parts with JSON objects. Verifies nothing. */
export function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, c, s] = parts as [string, string, string];
  const json = (part: string): Record<string, unknown> | null => {
    const bytes = base64UrlDecode(part);
    if (!bytes) return null;
    try {
      const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const header = json(h);
  const claims = json(c);
  const signature = base64UrlDecode(s);
  if (!header || !claims || !signature?.length) return null;
  return { header, claims, signingInput: enc.encode(`${h}.${c}`), signature };
}

const CLOCK_SKEW_SEC = 60;

/**
 * ID token claim checks (OpenID Connect Core §3.1.3.7); returns the first problem or `null`. The token must be for
 * this client (`aud`, and `azp` when present), from this provider, unexpired, and answer OUR request (`nonce`).
 */
export function idTokenProblem(claims: Record<string, unknown>, expect: { issuers: readonly string[]; clientId: string; nonce: string; nowSec: number }): string | null {
  if (typeof claims.iss !== "string" || !expect.issuers.includes(claims.iss)) return "issuer";
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expect.clientId)) return "audience";
  if (claims.azp !== undefined ? claims.azp !== expect.clientId : aud.length > 1) return "authorized_party";
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SEC < expect.nowSec) return "expired";
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_SEC > expect.nowSec) return "issued_in_future";
  if (typeof claims.nonce !== "string" || claims.nonce !== expect.nonce) return "nonce";
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) return "subject";
  return null;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Profile from verified claims; `null` without a usable e-mail. Names fall back to splitting `name`. */
export function profileOf(claims: Record<string, unknown>): SocialProfile | null {
  const email = clip(claims.email, 254).toLowerCase();
  if (typeof claims.sub !== "string" || !/^[^@\s]+@[^@\s]+$/.test(email)) return null;
  let firstName = clip(claims.given_name, 80);
  let lastName = clip(claims.family_name, 80);
  if (!firstName) {
    const [first = "", ...rest] = clip(claims.name, 160).split(/\s+/);
    firstName = first.slice(0, 80);
    lastName ||= rest.join(" ").slice(0, 80);
  }
  // Google sends a boolean; some providers send the string "true".
  return { subject: claims.sub, email, emailVerified: claims.email_verified === true || claims.email_verified === "true", firstName, lastName };
}
