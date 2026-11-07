import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { GetMailSettings, ListMailDeliveries, RemoveMailSettings, SaveMailSettings, SendTestMail, SmtpMailSender, type MailDeps } from "./application/mail-use-cases";
import type { MailDeliveryRepository, MailIntegrationRepository, MailSender, SmtpTransport } from "./application/ports";
import { D1MailDeliveryRepository } from "./infrastructure/d1-mail-delivery.repository";
import { D1MailIntegrationRepository } from "./infrastructure/d1-mail-integration.repository";
import { NodeSmtpTransport } from "./infrastructure/smtp-client";

export const MailIntegrationRepositoryToken = token<MailIntegrationRepository>("MailIntegrationRepository");
export const MailDeliveryRepositoryToken = token<MailDeliveryRepository>("MailDeliveryRepository");
/** SMTP wire client; tests replace this token with a fake. */
export const SmtpTransportToken = token<SmtpTransport>("SmtpTransport");
/** Port for other modules (identity → password reset). */
export const MailSenderToken = token<MailSender>("MailSender");
export const GetMailSettingsToken = token<GetMailSettings>("GetMailSettings");
export const SaveMailSettingsToken = token<SaveMailSettings>("SaveMailSettings");
export const RemoveMailSettingsToken = token<RemoveMailSettings>("RemoveMailSettings");
export const SendTestMailToken = token<SendTestMail>("SendTestMail");
export const ListMailDeliveriesToken = token<ListMailDeliveries>("ListMailDeliveries");

export function registerMail(c: Container): void {
  const deps = (r: Resolver): MailDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(MailIntegrationRepositoryToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken),
    ids: r.resolve(IdGeneratorToken), masterKey: r.resolve(ConfigToken).secretsMasterKey, transport: r.resolve(SmtpTransportToken),
    deliveries: r.resolve(MailDeliveryRepositoryToken), logger: r.resolve(LoggerToken),
  });
  c.singleton(SmtpTransportToken, () => new NodeSmtpTransport());
  c.scoped(MailIntegrationRepositoryToken, (r) => new D1MailIntegrationRepository(r.resolve(DatabaseToken)));
  c.scoped(MailDeliveryRepositoryToken, (r) => new D1MailDeliveryRepository(r.resolve(DatabaseToken)));
  c.scoped(ListMailDeliveriesToken, (r) => new ListMailDeliveries(r.resolve(MailDeliveryRepositoryToken)));
  c.scoped(MailSenderToken, (r) => new SmtpMailSender(deps(r)));
  c.scoped(GetMailSettingsToken, (r) => new GetMailSettings(r.resolve(MailIntegrationRepositoryToken)));
  c.scoped(SaveMailSettingsToken, (r) => new SaveMailSettings(deps(r)));
  c.scoped(RemoveMailSettingsToken, (r) => new RemoveMailSettings(deps(r)));
  c.scoped(SendTestMailToken, (r) => new SendTestMail(r.resolve(MailSenderToken), r.resolve(MailIntegrationRepositoryToken)));
}
