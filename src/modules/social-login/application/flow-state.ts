import { hmacHex, safeEqual, type Clock } from "@/core";
import type { SessionCookies } from "@/modules/identity";
import { base64UrlDecode, base64UrlEncode } from "../domain/oidc";
import type { SocialProvider } from "../domain/social";

/** Between "start" and the provider's callback. */
export interface LoginFlow {
  provider: SocialProvider;
  state: string;
  /** PKCE verifier. */
  verifier: string;
  nonce: string;
  /** Same-site path to land on after signing in. */
  next: string;
}

/** Between the callback and "üyeliği tamamla": a provider identity that has no account yet. */
export interface SignupDraft {
  provider: SocialProvider;
  subject: string;
  email: string;
  firstName: string;
  lastName: string;
  next: string;
}

export const OAUTH_FLOW_COOKIE = "__Host-nova_oauth";
export const SOCIAL_SIGNUP_COOKIE = "__Host-nova_social_signup";
const FLOW_TTL_MINUTES = 10;
const SIGNUP_TTL_MINUTES = 20;

/**
 * Short-lived state of a sign-in attempt, kept in the visitor's own browser instead of a table: HttpOnly `__Host-`
 * cookies whose value is signed with SESSION_SECRET (HMAC scope per cookie) and carries its own expiry. Nothing in
 * them is secret from the visitor — the signature is what matters: a signup draft names a provider identity and a
 * verified e-mail, and must not be forgeable. SameSite=Lax because the provider returns with a cross-site navigation.
 */
export class SocialFlowState {
  constructor(private readonly cookies: SessionCookies, private readonly secret: string, private readonly clock: Clock) {}

  putFlow(flow: LoginFlow): Promise<void> { return this.put(OAUTH_FLOW_COOKIE, "flow", flow, FLOW_TTL_MINUTES); }
  /** Single use: the cookie is removed whether or not it was valid. */
  async takeFlow(): Promise<LoginFlow | null> {
    const flow = await this.read<LoginFlow>(OAUTH_FLOW_COOKIE, "flow");
    await this.cookies.delete(OAUTH_FLOW_COOKIE);
    return flow;
  }

  putSignup(draft: SignupDraft): Promise<void> { return this.put(SOCIAL_SIGNUP_COOKIE, "signup", draft, SIGNUP_TTL_MINUTES); }
  readSignup(): Promise<SignupDraft | null> { return this.read<SignupDraft>(SOCIAL_SIGNUP_COOKIE, "signup"); }
  clearSignup(): Promise<void> { return this.cookies.delete(SOCIAL_SIGNUP_COOKIE); }

  private async put(cookie: string, scope: string, payload: object, ttlMinutes: number): Promise<void> {
    const expiresAt = this.clock.addMinutesIso(ttlMinutes, this.clock.now());
    const body = base64UrlEncode(JSON.stringify({ ...payload, exp: expiresAt }));
    await this.cookies.set(cookie, `${body}.${await this.sign(scope, body)}`, { expires: new Date(expiresAt), sameSite: "lax" });
  }

  private async read<T>(cookie: string, scope: string): Promise<T | null> {
    const raw = await this.cookies.get(cookie);
    const dot = raw?.lastIndexOf(".") ?? -1;
    if (!raw || dot < 1) return null;
    const body = raw.slice(0, dot);
    if (!safeEqual(raw.slice(dot + 1), await this.sign(scope, body))) return null;
    const bytes = base64UrlDecode(body);
    if (!bytes) return null;
    try {
      const { exp, ...payload } = JSON.parse(new TextDecoder().decode(bytes)) as { exp: string } & T;
      return typeof exp === "string" && exp > this.clock.nowIso() ? (payload as unknown as T) : null;
    } catch {
      return null;
    }
  }

  private sign(scope: string, body: string): Promise<string> {
    return hmacHex(this.secret, `social-${scope}:${body}`);
  }
}
