import type { OidcClient } from "../application/ports";
import { SocialErrors } from "../domain/errors";
import { OIDC_ENDPOINTS, decodeJwt, idTokenProblem, profileOf, type OidcEndpoints } from "../domain/oidc";
import type { SocialProfile, SocialProvider } from "../domain/social";

const TIMEOUT_MS = 8_000;
const KEYS_TTL_MS = 60 * 60 * 1000;
/** A code no provider issues: the answer only tells whether the client id + secret pair is known. */
const PROBE_CODE = "nova-client-probe";

type TokenBody = { id_token?: unknown; error?: unknown };
type Jwk = JsonWebKey & { kid?: string };

/**
 * Token endpoint + signing keys over HTTPS (endpoints are constants in domain/oidc.ts, never taken from input).
 * The ID token comes straight from the provider over TLS, and its signature is still checked against the provider's
 * published keys: a token is only trusted for what the provider signed.
 */
export class HttpOidcClient implements OidcClient {
  /** Signing keys per provider (kid → key); providers rotate them, so an unknown kid triggers one refetch. */
  private readonly keys = new Map<SocialProvider, { fetchedAt: number; byKid: Map<string, CryptoKey> }>();

  async exchange(provider: SocialProvider, input: { clientId: string; clientSecret: string; code: string; codeVerifier: string; redirectUri: string; nonce: string }): Promise<SocialProfile> {
    const ep = OIDC_ENDPOINTS[provider];
    const { status, body } = await this.token(ep, {
      grant_type: "authorization_code", code: input.code, client_id: input.clientId, client_secret: input.clientSecret,
      redirect_uri: input.redirectUri, code_verifier: input.codeVerifier,
    }).catch((err: unknown) => { throw SocialErrors.failed("token_unreachable", err); });
    if (status !== 200 || typeof body.id_token !== "string") throw SocialErrors.failed(`token:${String(body.error ?? `http_${status}`).slice(0, 60)}`);

    const jwt = decodeJwt(body.id_token);
    if (!jwt || jwt.header.alg !== "RS256" || typeof jwt.header.kid !== "string") throw SocialErrors.failed("id_token_malformed");
    const key = await this.signingKey(provider, ep, jwt.header.kid);
    if (!key || !(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, jwt.signature, jwt.signingInput))) throw SocialErrors.failed("id_token_signature");
    const problem = idTokenProblem(jwt.claims, { issuers: ep.issuers, clientId: input.clientId, nonce: input.nonce, nowSec: Date.now() / 1000 });
    if (problem) throw SocialErrors.failed(`id_token_${problem}`);
    const profile = profileOf(jwt.claims);
    if (!profile) throw SocialErrors.failed("id_token_no_email");
    return profile;
  }

  async probe(provider: SocialProvider, input: { clientId: string; clientSecret: string; redirectUri: string }): Promise<"accepted" | "rejected"> {
    let answer: { status: number; body: TokenBody };
    try {
      answer = await this.token(OIDC_ENDPOINTS[provider], {
        grant_type: "authorization_code", code: PROBE_CODE, client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri,
      });
    } catch (err) {
      throw SocialErrors.unreachable(err instanceof Error ? err.name : String(err)); // never the request: it holds the secret
    }
    if (answer.status >= 500 || answer.status === 429) throw SocialErrors.unreachable(`http_${answer.status}`);
    // The client is authenticated before the code is looked at: `invalid_client` = unknown id / wrong secret,
    // anything else (`invalid_grant` for our made-up code) = the pair is fine.
    return answer.body.error === "invalid_client" || answer.status === 401 ? "rejected" : "accepted";
  }

  private async token(ep: OidcEndpoints, form: Record<string, string>): Promise<{ status: number; body: TokenBody }> {
    const res = await fetch(ep.token, {
      method: "POST", body: new URLSearchParams(form), headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as TokenBody };
  }

  private async signingKey(provider: SocialProvider, ep: OidcEndpoints, kid: string): Promise<CryptoKey | null> {
    const cached = this.keys.get(provider);
    if (cached && Date.now() - cached.fetchedAt < KEYS_TTL_MS && cached.byKid.has(kid)) return cached.byKid.get(kid)!;
    let jwks: { keys?: Jwk[] };
    try {
      const res = await fetch(ep.jwks, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`http_${res.status}`);
      jwks = (await res.json()) as { keys?: Jwk[] };
    } catch (err) {
      throw SocialErrors.failed("jwks_unreachable", err);
    }
    const byKid = new Map<string, CryptoKey>();
    for (const jwk of Array.isArray(jwks.keys) ? jwks.keys : []) {
      if (jwk.kty !== "RSA" || typeof jwk.kid !== "string" || (jwk.use && jwk.use !== "sig")) continue;
      // the algorithm is fixed here, not read from the token header
      const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]).catch(() => null);
      if (key) byKid.set(jwk.kid, key);
    }
    this.keys.set(provider, { fetchedAt: Date.now(), byKid });
    return byKid.get(kid) ?? null;
  }
}
