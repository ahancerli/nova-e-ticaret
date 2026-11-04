import { z } from "zod";
import "@/modules/shared/schemas";
import { INTEGRATION_KINDS, SMS_EVENTS, SMS_TEMPLATE_MAX, type IntegrationKind, type SmsEvent } from "../domain/providers";

export const integrationKindParams = z.object({ kind: z.enum(INTEGRATION_KINDS as unknown as [IntegrationKind, ...IntegrationKind[]]) });

const smsEvent = z.object({
  enabled: z.boolean(),
  template: z.string().trim().max(SMS_TEMPLATE_MAX, `SMS metni en fazla ${SMS_TEMPLATE_MAX} karakter olabilir.`),
}).refine((e) => !e.enabled || e.template.length >= 5, { message: "Açık bildirim için SMS metnini yazın.", path: ["template"] });

export const integrationSaveSchema = z.object({
  providerCode: z.string().min(2).max(40).regex(/^[a-z0-9_]+$/, "Geçersiz sağlayıcı."),
  values: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), z.string().max(500)).refine((v) => Object.keys(v).length <= 20, "Çok fazla alan."),
  events: z.partialRecord(z.enum(SMS_EVENTS as unknown as [SmsEvent, ...SmsEvent[]]), smsEvent).optional(),
  expectedUpdatedAt: z.string().max(40).nullable(),
}).strict();

export const integrationDeleteSchema = z.object({ expectedUpdatedAt: z.string().min(1).max(40) }).strict();
export const integrationTestSchema = z.object({ phone: z.string().max(30).nullish() }).strict();
