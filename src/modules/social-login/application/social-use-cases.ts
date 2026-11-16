import {
  UnitOfWork, decryptSecret, encryptSecret, randomToken, safeEqual,
  type Clock, type Database, type IdGenerator, type Logger, type RateLimiter, type Statement,
} from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import { SIGNUP_LIMIT, type CustomerEnrollment } from "@/modules/customers";
import type { CredentialWriter, SessionIssuer, SessionRepository } from "@/modules/identity";
import type { Actor } from "@/modules/shared/actor";
import { SocialErrors } from "../domain/errors";
import { authorizationUrl, pkceChallenge } from "../domain/oidc";
import {
  SOCIAL_PROVIDERS, SOCIAL_PROVIDER_KEYS, SOCIAL_SIGNUP_PATH, socialCallbackPath,
  type PendingSocialSignup, type SocialProvider, type SocialProviderInput, type SocialProviderView, type SocialSignupInput,
} from "../domain/social";
import type { SocialFlowState } from "./flow-state";
import type { LinkableAccount, OidcClient, SealedSecret, SocialIdentityRepository, SocialProviderRepository, StoredSocialProvider } from "./ports";

const KEY_VERSION = "v1";
/** Welcome banner for a brand-new member who was not on their way somewhere else. */
const DEFAULT_TARGET = "/hesabim";
const WELCOME_TARGET = "/hesabim?hosgeldin=1";

export interface SocialDeps {
  db: Database;
  providers: SocialProviderRepository;
  identities: SocialIdentityRepository;
  oidc: OidcClient;
  flow: SocialFlowState;
  issuer: SessionIssuer;
  enrollment: CustomerEnrollment;
  credentials: CredentialWriter;
  sessions: SessionRepository;
  limiter: RateLimiter;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
  /** SECRETS_MASTER_KEY (base64, 32 bytes); empty = the client secret cannot be stored or read. */
  masterKey: string;
  /** PUBLIC_SITE_URL without a trailing slash; the callback address registered at the provider starts with it. */
  siteUrl: string;
}

const redirectUriOf = (siteUrl: string, provider: SocialProvider) => `${siteUrl}${socialCallbackPath(provider)}`;

async function openSecret(masterKey: string, sealed: SealedSecret): Promise<string | null> {
  if (!masterKey) return null;
  try { return await decryptSecret(masterKey, sealed); } catch { return null; } // wrong master key: treated as not configured
}

const viewOf = (provider: SocialProvider, s: StoredSocialProvider | undefined, siteUrl: string): SocialProviderView => ({
  provider, configured: !!s, enabled: s?.enabled ?? false, clientId: s?.clientId ?? "", secretHint: s?.secretHint ?? null,
  verifiedAt: s?.verifiedAt ?? null, updatedAt: s?.updatedAt ?? null, updatedBy: s?.updatedByName ?? null, redirectUri: redirectUriOf(siteUrl, provider),
});

/** Query: every provider of the catalogue for the panel (never the client secret). */
export class GetSocialLoginSettings {
  constructor(private readonly deps: Pick<SocialDeps, "providers" | "siteUrl">) {}
  async execute(): Promise<SocialProviderView[]> {
    const rows = await this.deps.providers.list();
    return SOCIAL_PROVIDER_KEYS.map((p) => viewOf(p, rows.find((r) => r.provider === p), this.deps.siteUrl));
  }
}

/** Query: providers whose button the storefront shows. */
export class GetEnabledSocialProviders {
  constructor(private readonly providers: SocialProviderRepository) {}
  async execute(): Promise<SocialProvider[]> {
    const rows = await this.providers.list();
    return SOCIAL_PROVIDER_KEYS.filter((p) => rows.some((r) => r.provider === p && r.enabled));
  }
}

/**
 * Command: save one provider's client. Whenever the keys change — or sign-in is switched on — the provider is asked
 * whether it knows this client id + secret pair, so a typo is caught here and not by the first customer who presses
 * the button. (A wrong redirect address cannot be probed; the panel shows the exact address to register.)
 */
export class SaveSocialProvider {
  constructor(private readonly deps: Pick<SocialDeps, "db" | "providers" | "oidc" | "audit" | "clock" | "masterKey" | "siteUrl">) {}

  async execute(provider: SocialProvider, input: SocialProviderInput, actor: Actor): Promise<SocialProviderView> {
    const { deps } = this;
    const meta = SOCIAL_PROVIDERS[provider];
    const existing = await deps.providers.find(provider);
    if ((existing?.updatedAt ?? null) !== input.expectedUpdatedAt) throw SocialErrors.changedMeanwhile();
    const clientId = input.clientId.trim();
    if (!meta.clientIdPattern.test(clientId)) throw SocialErrors.clientIdInvalid(meta.clientIdProblem);
    const newSecret = input.clientSecret?.trim() ?? "";
    if (!existing && !newSecret) throw SocialErrors.secretRequired();
    if (newSecret && !deps.masterKey) throw SocialErrors.masterKeyMissing();

    const now = deps.clock.nowIso();
    const keysChanged = !existing || !!newSecret || existing.clientId !== clientId;
    let verifiedAt = keysChanged ? null : existing.verifiedAt;
    if (keysChanged || input.enabled) {
      const secret = newSecret || (await openSecret(deps.masterKey, existing!.secret));
      if (!secret) throw SocialErrors.secretUnreadable();
      const verdict = await deps.oidc.probe(provider, { clientId, clientSecret: secret, redirectUri: redirectUriOf(deps.siteUrl, provider) });
      if (verdict === "rejected") throw SocialErrors.secretRejected();
      verifiedAt = now;
    }

    const sealed: SealedSecret | null = newSecret ? { ...(await encryptSecret(deps.masterKey, newSecret)), keyVersion: KEY_VERSION } : null;
    const hint = newSecret ? newSecret.slice(-4) : null;
    const row = { provider, enabled: input.enabled, clientId, verifiedAt, actorId: actor.userId, now };
    const uow = new UnitOfWork(deps.db);
    if (existing) uow.add(deps.providers.updateStatement({ ...row, secret: sealed, secretHint: hint }, existing.updatedAt)).expectChanges(1, SocialErrors.changedMeanwhile);
    else uow.add(deps.providers.insertStatement({ ...row, secret: sealed!, secretHint: hint! }));
    await uow
      .add(deps.audit.recordStatement({
        actor, action: "social_login.update", entityType: "social_login", entityId: provider,
        // the client secret itself never reaches the audit log
        diff: { enabled: row.enabled, clientId, secretChanged: !!sealed },
      }))
      .commit();
    return viewOf(provider, (await deps.providers.find(provider))!, deps.siteUrl);
  }
}

/** Command: begin a sign-in; returns the provider address the browser is sent to. */
export class StartSocialLogin {
  constructor(private readonly deps: Pick<SocialDeps, "providers" | "flow" | "siteUrl">) {}

  async execute(provider: SocialProvider, next: string): Promise<{ authorizationUrl: string }> {
    const config = await this.deps.providers.find(provider);
    if (!config?.enabled) throw SocialErrors.unavailable();
    // state ties the callback to this browser (CSRF), nonce ties the ID token to this request, PKCE ties the code to us
    const flow = { provider, state: randomToken(24), verifier: randomToken(48), nonce: randomToken(16), next };
    await this.deps.flow.putFlow(flow);
    return {
      authorizationUrl: authorizationUrl(provider, {
        clientId: config.clientId, redirectUri: redirectUriOf(this.deps.siteUrl, provider), state: flow.state, nonce: flow.nonce,
        codeChallenge: await pkceChallenge(flow.verifier),
      }),
    };
  }
}

export interface SocialCallback {
  code?: string;
  state?: string;
  /** Set by the provider instead of `code` (e.g. `access_denied` when the person pressed cancel). */
  error?: string;
}

/**
 * Command: the provider sent the person back. Decides, in this order:
 *  1. the provider identity is already linked → sign that member in;
 *  2. a member with the same (provider-verified) e-mail exists → link, then sign in;
 *  3. nobody yet → keep a signed draft and send the person to "üyeliği tamamla" (KVKK notice before the account exists).
 * Staff accounts never sign in here (the panel keeps password + MFA), suspended accounts stay out.
 *
 * Linking by e-mail to an account whose e-mail this shop never verified removes that account's password and ends its
 * sessions: sign-up does not verify e-mails, so the password may have been set by someone else who registered the
 * address first and is waiting for its owner to arrive ("pre-hijacking"). The real owner sets a new password with
 * "Şifremi unuttum" whenever they want one.
 */
export class CompleteSocialLogin {
  constructor(private readonly deps: SocialDeps) {}

  async execute(provider: SocialProvider, callback: SocialCallback, req: Request, requestId: string): Promise<{ redirectTo: string }> {
    const { deps } = this;
    const flow = await deps.flow.takeFlow();
    if (!flow || flow.provider !== provider || !callback.state || !safeEqual(flow.state, callback.state)) throw SocialErrors.flowExpired();
    if (callback.error === "access_denied") throw SocialErrors.cancelled();
    if (callback.error || !callback.code) throw SocialErrors.failed(`callback:${String(callback.error ?? "no_code").slice(0, 60)}`);

    const config = await deps.providers.find(provider);
    if (!config?.enabled) throw SocialErrors.unavailable();
    const clientSecret = await openSecret(deps.masterKey, config.secret);
    if (!clientSecret) {
      deps.logger.error("social login client secret unreadable", { provider });
      throw SocialErrors.unavailable();
    }
    const profile = await deps.oidc.exchange(provider, {
      clientId: config.clientId, clientSecret, code: callback.code, codeVerifier: flow.verifier, nonce: flow.nonce,
      redirectUri: redirectUriOf(deps.siteUrl, provider),
    });

    const now = deps.clock.nowIso();
    const statements: Statement[] = [];
    let account: LinkableAccount;
    const linked = await deps.identities.findBySubject(provider, profile.subject);
    if (linked) {
      account = linked;
      this.assertUsable(account);
      statements.push(deps.identities.touchStatement(linked.identityId, now));
    } else {
      // Only an address the provider itself verified may claim an existing account or create one.
      if (!profile.emailVerified) throw SocialErrors.emailUnverified();
      const byEmail = await deps.identities.findAccountByEmail(profile.email);
      if (!byEmail) {
        await deps.flow.putSignup({ provider, subject: profile.subject, email: profile.email, firstName: profile.firstName, lastName: profile.lastName, next: flow.next });
        return { redirectTo: SOCIAL_SIGNUP_PATH };
      }
      account = byEmail;
      this.assertUsable(account);
      const passwordRemoved = !account.emailVerified && account.hasPassword;
      statements.push(deps.identities.insertStatement({ id: deps.ids.newId(), userId: account.userId, provider, subject: profile.subject, now }));
      if (!account.emailVerified) {
        statements.push(deps.identities.dropPasswordStatement(account.userId), deps.sessions.revokeAllStatement(account.userId, now), deps.credentials.markEmailVerifiedStatement(account.userId, now));
      }
      statements.push(deps.audit.recordStatement({
        actor: { userId: account.userId, requestId }, action: "customer.social_link", entityType: "user", entityId: account.userId, diff: { provider, passwordRemoved },
      }));
    }

    const session = await deps.issuer.prepare({ userId: account.userId, audience: "storefront", ipKey: await deps.limiter.clientKey(req) });
    await new UnitOfWork(deps.db).add(...statements).add(...session.statements).commit();
    await session.activate();
    return { redirectTo: flow.next };
  }

  private assertUsable(account: LinkableAccount): void {
    if (account.isStaff) throw SocialErrors.staffAccount();
    if (account.status !== "active") throw SocialErrors.accountUnavailable();
  }
}

/** Query: the draft behind "üyeliği tamamla" (`null` = expired or never started). */
export class GetPendingSocialSignup {
  constructor(private readonly flow: SocialFlowState) {}
  async execute(): Promise<PendingSocialSignup | null> {
    const d = await this.flow.readSignup();
    return d ? { provider: d.provider, email: d.email, firstName: d.firstName, lastName: d.lastName } : null;
  }
}

/**
 * Command: create the member from the signed draft once the person confirmed their name and the KVKK notice.
 * Account, consents, the provider link and the first session are one transaction; the e-mail counts as verified
 * (the provider vouched for it) and the account has no password until the person sets one with "Şifremi unuttum".
 */
export class FinishSocialSignup {
  constructor(private readonly deps: SocialDeps) {}

  async execute(input: SocialSignupInput, req: Request, requestId: string): Promise<{ userId: string; next: string }> {
    const { deps } = this;
    const ipKey = await deps.limiter.clientKey(req);
    await deps.limiter.hit(`signup:${ipKey}`, SIGNUP_LIMIT.limit, SIGNUP_LIMIT.windowSec);
    const draft = await deps.flow.readSignup();
    if (!draft) throw SocialErrors.signupExpired();
    if (!(await deps.providers.find(draft.provider))?.enabled) throw SocialErrors.unavailable();

    const member = await deps.enrollment.prepare({
      email: draft.email, firstName: input.firstName, lastName: input.lastName, phone: null,
      marketingEmail: input.marketingEmail, marketingSms: input.marketingSms, requestId, method: draft.provider,
    });
    const now = deps.clock.nowIso();
    const session = await deps.issuer.prepare({ userId: member.userId, audience: "storefront", ipKey });
    await new UnitOfWork(deps.db)
      .add(...member.statements)
      .add(deps.credentials.markEmailVerifiedStatement(member.userId, now))
      .add(deps.identities.insertStatement({ id: deps.ids.newId(), userId: member.userId, provider: draft.provider, subject: draft.subject, now }))
      .add(...session.statements)
      .commit();
    await deps.flow.clearSignup();
    await session.activate();
    return { userId: member.userId, next: draft.next === DEFAULT_TARGET ? WELCOME_TARGET : draft.next };
  }
}
