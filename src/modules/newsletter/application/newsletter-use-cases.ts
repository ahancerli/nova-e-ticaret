import { UnitOfWork, hmacHex, randomToken, safeEqual, sha256Hex, type Clock, type Database, type IdGenerator, type Logger } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { MailSender } from "@/modules/mail";
import type { Actor } from "@/modules/shared/actor";
import { NewsletterErrors } from "../domain/errors";
import {
  CONFIRM_HOURS, RESEND_MINUTES, SUBSCRIBE_MESSAGE, maskAddress, type SubscriberQuery, type SubscriberRow, type SubscriberSource, type SubscriberTab,
} from "../domain/newsletter";
import { buildConfirmMail, type NewsletterMailContext } from "../domain/newsletter-mail";
import type { NewsletterRepository } from "./ports";

export interface NewsletterDeps {
  db: Database;
  repo: NewsletterRepository;
  clock: Clock;
  ids: IdGenerator;
  /** SESSION_SECRET: signs unsubscribe links and keys the guest consent hash. */
  secret: string;
}

const unsubscribeSig = (secret: string, id: string) => hmacHex(secret, `newsletter-unsub:${id}`);
const guestHash = (secret: string, email: string) => hmacHex(secret, `customer:${email}`);

/** Unsubscribe link for a subscriber (newsletter mails put it in the footer). */
export async function unsubscribeUrl(siteUrl: string, secret: string, id: string): Promise<string> {
  return `${siteUrl}/bulten/ayril?u=${encodeURIComponent(id)}&s=${await unsubscribeSig(secret, id)}`;
}

/**
 * Command (footer form): records a pending sign-up and e-mails a confirmation link (double opt-in). The answer is
 * the same whether the address is new, pending or already subscribed; one confirmation e-mail per address per
 * RESEND_MINUTES. Mail goes out after the commit; a failure is logged, never shown (no address probing).
 */
export class SubscribeNewsletter {
  constructor(
    private readonly deps: NewsletterDeps, private readonly mail: MailSender, private readonly context: () => Promise<NewsletterMailContext>,
    private readonly consentVersion: () => Promise<string>, private readonly logger: Logger,
  ) {}

  async execute(input: { email: string; source: SubscriberSource }, ctx: { ipHash: string }): Promise<{ message: string }> {
    const { repo, clock, ids, db } = this.deps;
    const email = input.email.trim().toLowerCase();
    const done = { message: SUBSCRIBE_MESSAGE };
    const existing = await repo.findByEmail(email);
    if (existing?.status === "subscribed") return done;
    const now = clock.nowIso();
    if (existing?.status === "pending" && existing.confirmSentAt && existing.confirmSentAt > clock.addMinutesIso(-RESEND_MINUTES)) return done;

    const token = randomToken();
    const row = {
      tokenHash: await sha256Hex(token), expiresAt: clock.addMinutesIso(CONFIRM_HOURS * 60), consentVersion: await this.consentVersion(),
      userId: await repo.memberIdByEmail(email), ipHash: ctx.ipHash, now,
    };
    const uow = new UnitOfWork(db);
    if (existing) uow.add(repo.renewStatement({ ...row, id: existing.id, from: existing.status }));
    else uow.add(repo.insertStatement({ ...row, id: ids.newId(), email, source: input.source }));
    try {
      const [res] = await uow.commit();
      if (!res?.meta.changes) return done; // another request changed the row meanwhile: its mail is on the way
    } catch (err) {
      // two sign-ups of a new address at once: the other insert won (UNIQUE email)
      if (!existing && (await repo.findByEmail(email))) return done;
      throw err;
    }

    try {
      const result = await this.mail.send({ purpose: "other", to: email, ...buildConfirmMail(token, await this.context()) });
      if (result === "not_configured") this.logger.warn("newsletter confirmation not sent: SMTP is not configured", { email: maskAddress(email) });
    } catch (err) {
      this.logger.warn("newsletter confirmation e-mail failed", { email: maskAddress(email), error: err instanceof Error ? err.message : String(err) });
    }
    return done;
  }
}

/** Command (/bulten/onay): the link's token → subscribed, plus the marketing_email consent as evidence. */
export class ConfirmNewsletter {
  constructor(private readonly deps: NewsletterDeps, private readonly consentVersion: () => Promise<string>) {}

  async execute(token: string): Promise<{ email: string }> {
    const { repo, clock, ids, db, secret } = this.deps;
    const tokenHash = await sha256Hex(token);
    const now = clock.nowIso();
    const sub = await repo.findByToken(tokenHash, now);
    if (!sub) throw NewsletterErrors.linkInvalid();
    await new UnitOfWork(db)
      .add(repo.confirmStatement(sub.id, tokenHash, now)).expectChanges(1, NewsletterErrors.linkInvalid)
      .add(repo.consentStatement({
        id: ids.newId(), userId: sub.userId, guestHash: sub.userId ? null : await guestHash(secret, sub.email), version: await this.consentVersion(), granted: true, now,
      }))
      .commit();
    return { email: maskAddress(sub.email) };
  }
}

/** Command (/bulten/ayril, link in every newsletter): signed id → unsubscribed + consent withdrawn. Idempotent. */
export class UnsubscribeNewsletter {
  constructor(private readonly deps: NewsletterDeps, private readonly consentVersion: () => Promise<string>) {}

  async execute(id: string, sig: string): Promise<{ email: string }> {
    const { repo, clock, ids, db, secret } = this.deps;
    if (!safeEqual(sig, await unsubscribeSig(secret, id))) throw NewsletterErrors.linkInvalid();
    const sub = await repo.find(id);
    if (!sub) throw NewsletterErrors.linkInvalid();
    if (sub.status === "unsubscribed") return { email: maskAddress(sub.email) };
    const now = clock.nowIso();
    const uow = new UnitOfWork(db).add(repo.unsubscribeStatement(id, now));
    if (sub.status === "subscribed") {
      uow.add(repo.consentStatement({
        id: ids.newId(), userId: sub.userId, guestHash: sub.userId ? null : await guestHash(secret, sub.email), version: await this.consentVersion(), granted: false, now,
      }));
    }
    await uow.commit();
    return { email: maskAddress(sub.email) };
  }
}

/** Query (panel E-bülten): search, status tabs with counts, allowlisted sort, paging. */
export class ListSubscribers {
  constructor(private readonly repo: NewsletterRepository) {}

  execute(q: SubscriberQuery): Promise<{ rows: SubscriberRow[]; total: number; counts: Record<SubscriberTab, number> }> {
    return this.repo.list(q);
  }
}

/** Command (panel): erase a subscriber (KVKK deletion request). Consent history stays as evidence. */
export class RemoveSubscriber {
  constructor(private readonly deps: NewsletterDeps, private readonly audit: AuditLog) {}

  async execute(id: string, actor: Actor): Promise<{ removed: true }> {
    const { repo, db } = this.deps;
    const sub = await repo.find(id);
    if (!sub) throw NewsletterErrors.notFound();
    await new UnitOfWork(db)
      .add(repo.deleteStatement(id)).expectChanges(1, NewsletterErrors.notFound)
      .add(this.audit.recordStatement({ actor, action: "newsletter.delete", entityType: "newsletter_subscriber", entityId: id, diff: { email: maskAddress(sub.email), status: sub.status } }))
      .commit();
    return { removed: true };
  }
}
