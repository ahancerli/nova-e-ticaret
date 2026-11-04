import { UnitOfWork, ValidationError, type Clock, type Database, type IdGenerator, type Logger, type Statement } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { MailSender } from "@/modules/mail";
import { passwordResetEmail } from "../domain/password-reset-email";
import { passwordProblems } from "../domain/password-policy";
import { IdentityErrors } from "../domain/errors";
import type { AccountTokenPurpose, AccountTokenRepository, CredentialRepository, CredentialWriter, PasswordHasher, SessionRepository, TokenService } from "./ports";

/** How long a link stays usable: invitations a week (time to get to it), resets a day. */
export const LINK_TTL_MINUTES: Record<AccountTokenPurpose, number> = { staff_invite: 7 * 24 * 60, password_reset: 24 * 60 };

export interface IssuedLink {
  token: string;
  expiresAt: string;
  /** Add to the caller's UnitOfWork: earlier links of the purpose are invalidated, the new one stored. */
  statements: Statement[];
}

/**
 * Issues one-time account links. The raw token leaves the server exactly once (to be delivered to the person);
 * the database keeps only its HMAC. No e-mail provider is connected yet, so callers hand the link to the admin.
 */
export class AccountLinks {
  constructor(private readonly tokens: TokenService, private readonly repo: AccountTokenRepository, private readonly clock: Clock, private readonly ids: IdGenerator) {}

  async issue(userId: string, purpose: AccountTokenPurpose): Promise<IssuedLink> {
    const token = this.tokens.newToken();
    const now = this.clock.nowIso();
    const expiresAt = this.clock.addMinutesIso(LINK_TTL_MINUTES[purpose]);
    return {
      token,
      expiresAt,
      statements: [
        this.repo.invalidateStatement(userId, purpose, now),
        this.repo.insertStatement({ id: this.ids.newId(), userId, purpose, tokenHash: await this.tokens.hashAccountToken(token), expiresAt }),
      ],
    };
  }

  pending(userId: string, purpose: AccountTokenPurpose) {
    return this.repo.pending(userId, purpose, this.clock.nowIso());
  }
}

/** Public path that sets a password from a link (staff use the panel pages, customers the storefront page). */
export const accountLinkPath = (audience: "staff" | "customer", token: string) =>
  audience === "staff" ? `/admin/sifre/${token}` : `/hesap/sifre/${token}`;

export interface LinkInfo {
  purpose: AccountTokenPurpose;
  audience: "staff" | "customer";
  displayName: string;
  email: string;
}

/** Query: who a link belongs to (for the set-password page), or null when unknown / used / expired. */
export class PeekAccountLink {
  constructor(private readonly tokens: TokenService, private readonly repo: AccountTokenRepository, private readonly clock: Clock) {}

  async execute(token: string): Promise<LinkInfo | null> {
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) return null;
    const h = await this.repo.findValid(await this.tokens.hashAccountToken(token), this.clock.nowIso());
    if (!h || h.status !== "active") return null;
    return { purpose: h.purpose, audience: h.isStaff ? "staff" : "customer", displayName: h.displayName, email: h.email };
  }
}

export interface CompleteLinkDeps {
  db: Database;
  tokens: TokenService;
  links: AccountTokenRepository;
  credentials: CredentialWriter;
  sessions: SessionRepository;
  passwords: PasswordHasher;
  audit: AuditLog;
  clock: Clock;
}

/**
 * Command: the person sets their own password from an invitation / reset link. One transaction: the link is
 * consumed (guarded — a second use fails), the password stored, the e-mail counted as verified (they received
 * the link) and every existing session ended.
 */
export class CompleteAccountLink {
  constructor(private readonly deps: CompleteLinkDeps) {}

  async execute(token: string, password: string, requestId: string): Promise<{ audience: "staff" | "customer"; email: string }> {
    const { deps } = this;
    const now = deps.clock.nowIso();
    const holder = /^[A-Za-z0-9_-]{20,128}$/.test(token) ? await deps.links.findValid(await deps.tokens.hashAccountToken(token), now) : null;
    if (!holder || holder.status !== "active") throw IdentityErrors.linkInvalid();

    const problems = passwordProblems(password, { email: holder.email, name: holder.displayName });
    if (problems.length) throw new ValidationError("weak_password", problems[0]!, { fieldErrors: { password: problems } });

    await new UnitOfWork(deps.db)
      .add(deps.links.consumeStatement(holder.tokenId, now))
      .expectChanges(1, IdentityErrors.linkInvalid)
      .add(deps.credentials.setPasswordStatement(holder.userId, await deps.passwords.hash(password), now))
      .add(deps.credentials.markEmailVerifiedStatement(holder.userId, now))
      .add(deps.sessions.revokeAllStatement(holder.userId, now))
      .add(deps.audit.recordStatement({
        actor: { userId: holder.userId, requestId }, action: holder.purpose === "staff_invite" ? "account.invite_accepted" : "account.password_reset",
        entityType: "user", entityId: holder.userId, diff: {},
      }))
      .commit();
    return { audience: holder.isStaff ? "staff" : "customer", email: holder.email };
  }
}

export interface RequestResetDeps {
  db: Database;
  credentials: CredentialRepository;
  links: AccountLinks;
  mailer: MailSender;
  clock: Clock;
  logger: Logger;
  /** PUBLIC_SITE_URL without trailing slash (links in e-mails must be absolute). */
  siteUrl: string;
  isProduction: boolean;
}

/** A fresh request inside this window does not issue / send another link (mail-bombing guard). */
export const RESET_RESEND_MINUTES = 2;

/**
 * Command: "Parolamı unuttum". Issues a single-use reset link and e-mails it through the shop's SMTP account.
 * The HTTP layer answers the same thing whatever happens here (and runs this after the response), so neither the
 * answer nor its timing reveals whether an account exists. Unknown, suspended or wrong-audience e-mails get nothing.
 * Without SMTP settings the link is logged in development only (never in production logs).
 */
export class RequestPasswordReset {
  constructor(private readonly deps: RequestResetDeps) {}

  async execute(email: string, audience: "staff" | "customer", brand: string): Promise<"sent" | "skipped" | "throttled" | "not_configured"> {
    const { deps } = this;
    const account = await deps.credentials.findAccount(email.trim().toLowerCase());
    if (!account || account.status !== "active" || account.isStaff !== (audience === "staff")) return "skipped";

    const pending = await deps.links.pending(account.userId, "password_reset");
    if (pending) {
      const issuedAt = Date.parse(pending.expiresAt) - LINK_TTL_MINUTES.password_reset * 60_000;
      if (deps.clock.now().getTime() - issuedAt < RESET_RESEND_MINUTES * 60_000) return "throttled";
    }

    const link = await deps.links.issue(account.userId, "password_reset");
    const uow = new UnitOfWork(deps.db);
    for (const st of link.statements) uow.add(st);
    await uow.commit();

    const url = `${deps.siteUrl}${accountLinkPath(audience, link.token)}`;
    const result = await deps.mailer.send(passwordResetEmail({
      to: account.email, name: account.displayName, link: url, brand, ttlHours: LINK_TTL_MINUTES.password_reset / 60, panel: audience === "staff",
    }));
    if (result === "not_configured") {
      if (deps.isProduction) deps.logger.warn("password reset requested but SMTP is not configured", { userId: account.userId });
      else deps.logger.info("password reset link (SMTP not configured — development only)", { resetLink: url });
    }
    return result;
  }
}
