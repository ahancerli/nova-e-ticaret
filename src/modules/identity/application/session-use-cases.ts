import { RateLimitError, UnitOfWork, type Audience, type Authenticator, type Clock, type Database, type IdGenerator, type Logger, type Principal, type RateLimiter } from "@/core";
import { IdentityErrors } from "../domain/errors";
import { LOGIN_LIMITS, SESSION_POLICIES } from "../domain/session-policy";
import type { CredentialRepository, LoginListener, PasswordHasher, PermissionRepository, SessionCookies, SessionRepository, TokenService } from "./ports";

/** Query (also the core Authenticator port): the principal behind the session cookie of an audience. */
export class GetCurrentPrincipal implements Authenticator {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly permissions: PermissionRepository,
    private readonly cookies: SessionCookies,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
  ) {}

  async current(audience: Audience): Promise<Principal | null> {
    let token: string | undefined;
    for (const name of SESSION_POLICIES[audience].readCookies) {
      token = await this.cookies.get(name);
      if (token) break;
    }
    if (!token) return null;
    const session = await this.sessions.findActive(await this.tokens.hash(token), this.clock.nowIso());
    if (!session) return null;
    return {
      id: session.userId,
      email: session.email,
      displayName: session.displayName,
      sessionId: session.sessionId,
      isStaff: session.isStaff,
      permissions: new Set(await this.permissions.permissionsOf(session.userId)),
    };
  }
}

export interface LoginDeps {
  db: Database;
  credentials: CredentialRepository;
  sessions: SessionRepository;
  passwords: PasswordHasher;
  tokens: TokenService;
  cookies: SessionCookies;
  limiter: RateLimiter;
  listeners: LoginListener[];
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
}

export interface LoginCommand {
  email: string;
  password: string;
  audience: Audience;
  /** Request of the attempt (client IP → rate-limit buckets and sessions.ip_hash). */
  req: Request;
  /** Per-IP bucket name; defaults to "<audience>-login-fail". The legacy endpoint keeps "login-fail". */
  ipBucket?: string;
}

/**
 * Command: password login for one audience. On success a session row is stored (only the token's HMAC),
 * the cookie is set and login listeners run; every failure looks the same to the caller.
 */
export class Login {
  constructor(private readonly deps: LoginDeps) {}

  async execute(cmd: LoginCommand): Promise<{ userId: string; expiresAt: string }> {
    const { deps } = this;
    const policy = SESSION_POLICIES[cmd.audience];
    const ipKey = await deps.limiter.clientKey(cmd.req);
    const ipBucket = `${cmd.ipBucket ?? `${cmd.audience}-login-fail`}:${ipKey}`;
    await deps.limiter.check(ipBucket, LOGIN_LIMITS.perIp.limit, LOGIN_LIMITS.perIp.windowSec);

    const credential = await deps.credentials.findByEmail(cmd.email.trim().toLowerCase());
    const accountBucket = credential ? `login-account-fail:${credential.userId}:${ipKey}` : null;
    // Always verify (dummy hash for unknown e-mails) so response time does not reveal which accounts exist.
    const passwordOk = await deps.passwords.verify(cmd.password, credential?.passwordHash ?? null);
    const blockedHere = accountBucket ? await this.isBlocked(accountBucket) : false;

    const allowed = credential && passwordOk && !blockedHere && credential.status === "active" && credential.isStaff === (policy.accounts === "staff");
    if (!allowed) {
      await this.recordFailure(ipBucket, accountBucket, credential && !passwordOk ? credential.userId : null);
      throw IdentityErrors.invalidCredentials();
    }

    const token = deps.tokens.newToken();
    const now = deps.clock.now();
    const expiresAt = deps.clock.addMinutesIso(policy.ttlMinutes, now);
    await new UnitOfWork(deps.db)
      .add(deps.sessions.createStatement({ id: deps.ids.newId(), userId: credential.userId, tokenHash: await deps.tokens.hash(token), expiresAt, ipHash: ipKey }))
      .add(deps.credentials.resetFailuresStatement(credential.userId, now.toISOString()))
      .add(deps.sessions.touchLoginStatement(credential.userId, now.toISOString()))
      .commit();
    await deps.cookies.set(policy.cookie, token, { expires: new Date(expiresAt), sameSite: policy.sameSite });

    for (const listener of deps.listeners) {
      // A listener (e.g. guest-cart merge) must not turn a successful login into an error.
      await listener.onLogin({ userId: credential.userId, audience: cmd.audience }).catch((err: unknown) =>
        deps.logger.warn("login listener failed", { audience: cmd.audience, error: String(err) }));
    }
    return { userId: credential.userId, expiresAt };
  }

  private async isBlocked(bucket: string): Promise<boolean> {
    try {
      await this.deps.limiter.check(bucket, LOGIN_LIMITS.perAccountAndIp.limit, LOGIN_LIMITS.perAccountAndIp.windowSec);
      return false;
    } catch (err) {
      if (err instanceof RateLimitError) return true;
      throw err;
    }
  }

  private async recordFailure(ipBucket: string, accountBucket: string | null, wrongPasswordFor: string | null) {
    const { limiter, credentials, clock } = this.deps;
    const swallowLimit = (p: Promise<void>) => p.catch((err: unknown) => { if (!(err instanceof RateLimitError)) throw err; });
    await swallowLimit(limiter.hit(ipBucket, LOGIN_LIMITS.perIp.limit, LOGIN_LIMITS.perIp.windowSec));
    if (accountBucket) await swallowLimit(limiter.hit(accountBucket, LOGIN_LIMITS.perAccountAndIp.limit, LOGIN_LIMITS.perAccountAndIp.windowSec));
    if (wrongPasswordFor) await credentials.recordFailure(wrongPasswordFor, clock.nowIso());
  }
}

/** Command: revokes the session(s) of an audience and clears its cookies. */
export class Logout {
  constructor(private readonly sessions: SessionRepository, private readonly cookies: SessionCookies, private readonly tokens: TokenService, private readonly clock: Clock) {}

  async execute(audience: Audience | "all"): Promise<void> {
    const audiences: Audience[] = audience === "all" ? ["storefront", "admin"] : [audience];
    for (const a of audiences) {
      for (const name of SESSION_POLICIES[a].readCookies) {
        const token = await this.cookies.get(name);
        if (token) await this.sessions.revoke(await this.tokens.hash(token), this.clock.nowIso());
        await this.cookies.delete(name);
      }
    }
  }
}
