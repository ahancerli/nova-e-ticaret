import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { MAX_RULE_RECIPIENTS, NOTIFICATION_FILTERS, NOTIFICATION_TYPE_KEYS, type NotificationFilter, type NotificationType } from "../domain/notification";

const type = z.enum(NOTIFICATION_TYPE_KEYS as [NotificationType, ...NotificationType[]]);
const ids = z.array(entityId).min(1).max(80);

export const notificationQuerySchema = z.object({
  filter: z.enum(Object.keys(NOTIFICATION_FILTERS) as [NotificationFilter, ...NotificationFilter[]]).default("all"),
  type: type.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export const notificationReadSchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ ids, read: z.boolean().default(true) }).strict(),
]);

export const notificationArchiveSchema = z.object({ ids, archived: z.boolean().default(true) }).strict();

export const notificationRulesSchema = z.object({
  rules: z.array(z.object({
    type,
    inApp: z.boolean(),
    email: z.boolean(),
    emailTo: z.array(z.email("Geçerli bir e-posta girin.").max(254)).max(MAX_RULE_RECIPIENTS, `En fazla ${MAX_RULE_RECIPIENTS} alıcı.`),
  }).strict()).min(1).max(NOTIFICATION_TYPE_KEYS.length),
}).strict();

export const notificationPreferencesSchema = z.object({ muted: z.array(type).max(NOTIFICATION_TYPE_KEYS.length) }).strict();
