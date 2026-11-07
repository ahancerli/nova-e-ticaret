import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { MailSenderToken } from "@/modules/mail";
import { addOutboxHandler } from "@/modules/outbox";
import { GetPublicSettingsToken } from "@/modules/settings";
import {
  GetNotificationRules, GetNotificationSummary, ListNotifications, NotificationPreferences, PublishNotification, RaiseNotification, SendNotificationEmail,
  UpdateNotificationRules, UpdateNotificationState,
} from "./application/notification-use-cases";
import { OrderPlacedNotice, PaymentLateNotice } from "./application/panel-handlers";
import type { NotificationPublisher, NotificationRepository } from "./application/ports";
import { D1NotificationRepository, D1OrderFacts } from "./infrastructure/d1-notification.repository";

export const NotificationRepositoryToken = token<NotificationRepository>("NotificationRepository");
export const NotificationPublisherToken = token<NotificationPublisher>("NotificationPublisher");
export const RaiseNotificationToken = token<RaiseNotification>("RaiseNotification");
export const ListNotificationsToken = token<ListNotifications>("ListNotifications");
export const GetNotificationSummaryToken = token<GetNotificationSummary>("GetNotificationSummary");
export const UpdateNotificationStateToken = token<UpdateNotificationState>("UpdateNotificationState");
export const GetNotificationRulesToken = token<GetNotificationRules>("GetNotificationRules");
export const UpdateNotificationRulesToken = token<UpdateNotificationRules>("UpdateNotificationRules");
export const NotificationPreferencesToken = token<NotificationPreferences>("NotificationPreferences");

/** Panel notifications (bell + Bildirimler) and the outbox handlers that produce / e-mail them. */
export function registerPanelNotifications(c: Container): void {
  c.scoped(NotificationRepositoryToken, (r) => new D1NotificationRepository(r.resolve(DatabaseToken)));
  c.scoped(NotificationPublisherToken, (r) => new PublishNotification(r.resolve(NotificationRepositoryToken), r.resolve(IdGeneratorToken), r.resolve(ClockToken)));
  c.scoped(RaiseNotificationToken, (r) => new RaiseNotification(r.resolve(DatabaseToken), r.resolve(NotificationPublisherToken)));
  c.scoped(ListNotificationsToken, (r) => new ListNotifications(r.resolve(NotificationRepositoryToken)));
  c.scoped(GetNotificationSummaryToken, (r) => new GetNotificationSummary(r.resolve(NotificationRepositoryToken)));
  c.scoped(UpdateNotificationStateToken, (r) => new UpdateNotificationState(r.resolve(DatabaseToken), r.resolve(NotificationRepositoryToken), r.resolve(ClockToken)));
  c.scoped(GetNotificationRulesToken, (r) => new GetNotificationRules(r.resolve(NotificationRepositoryToken)));
  c.scoped(UpdateNotificationRulesToken, (r) => new UpdateNotificationRules(r.resolve(DatabaseToken), r.resolve(NotificationRepositoryToken), r.resolve(AuditLogToken), r.resolve(ClockToken)));
  c.scoped(NotificationPreferencesToken, (r) => new NotificationPreferences(r.resolve(DatabaseToken), r.resolve(NotificationRepositoryToken)));

  addOutboxHandler("order.placed", (r) => new OrderPlacedNotice(new D1OrderFacts(r.resolve(DatabaseToken)), r.resolve(RaiseNotificationToken)));
  addOutboxHandler("order.payment_after_cancel", (r) => new PaymentLateNotice(new D1OrderFacts(r.resolve(DatabaseToken)), r.resolve(RaiseNotificationToken)));
  addOutboxHandler("admin_notification.email", (r) => new SendNotificationEmail(
    r.resolve(MailSenderToken), async () => (await r.resolve(GetPublicSettingsToken).execute()).siteName, r.resolve(ConfigToken).publicSiteUrl, r.resolve(LoggerToken),
  ));
}
