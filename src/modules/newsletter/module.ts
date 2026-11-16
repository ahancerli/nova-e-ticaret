import { IysQueueToken } from "@/modules/iys";
import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { GetSignupLegalToken } from "@/modules/content";
import { MailSenderToken } from "@/modules/mail";
import { GetPublicSettingsToken } from "@/modules/settings";
import {
  ConfirmNewsletter, ListSubscribers, RemoveSubscriber, SubscribeNewsletter, UnsubscribeNewsletter, type NewsletterDeps,
} from "./application/newsletter-use-cases";
import type { NewsletterRepository } from "./application/ports";
import { D1NewsletterRepository } from "./infrastructure/d1-newsletter.repository";

export const NewsletterRepositoryToken = token<NewsletterRepository>("NewsletterRepository");
export const SubscribeNewsletterToken = token<SubscribeNewsletter>("SubscribeNewsletter");
export const ConfirmNewsletterToken = token<ConfirmNewsletter>("ConfirmNewsletter");
export const UnsubscribeNewsletterToken = token<UnsubscribeNewsletter>("UnsubscribeNewsletter");
export const ListSubscribersToken = token<ListSubscribers>("ListSubscribers");
export const RemoveSubscriberToken = token<RemoveSubscriber>("RemoveSubscriber");

export function registerNewsletter(c: Container): void {
  const deps = (r: Resolver): NewsletterDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(NewsletterRepositoryToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
    secret: r.resolve(ConfigToken).sessionSecret, iys: r.resolve(IysQueueToken),
  });
  // the KVKK notice version shown next to the form (same document as sign-up)
  const consentVersion = (r: Resolver) => async () => (await r.resolve(GetSignupLegalToken).execute()).consentVersion;
  c.scoped(NewsletterRepositoryToken, (r) => new D1NewsletterRepository(r.resolve(DatabaseToken)));
  c.scoped(SubscribeNewsletterToken, (r) => new SubscribeNewsletter(
    deps(r), r.resolve(MailSenderToken),
    async () => {
      const s = await r.resolve(GetPublicSettingsToken).execute();
      return { brand: s.siteName, siteUrl: r.resolve(ConfigToken).publicSiteUrl, accent: s.accentColor ?? "#f21c99" };
    },
    consentVersion(r), r.resolve(LoggerToken),
  ));
  c.scoped(ConfirmNewsletterToken, (r) => new ConfirmNewsletter(deps(r), consentVersion(r)));
  c.scoped(UnsubscribeNewsletterToken, (r) => new UnsubscribeNewsletter(deps(r), consentVersion(r)));
  c.scoped(ListSubscribersToken, (r) => new ListSubscribers(r.resolve(NewsletterRepositoryToken)));
  c.scoped(RemoveSubscriberToken, (r) => new RemoveSubscriber(deps(r), r.resolve(AuditLogToken)));
}
