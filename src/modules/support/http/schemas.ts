import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { SUPPORT_MESSAGE_MAX, SUPPORT_STATUSES } from "../domain/support";

const body = z.string().trim().min(1, "Mesajınızı yazın.").max(SUPPORT_MESSAGE_MAX, `Mesaj en fazla ${SUPPORT_MESSAGE_MAX} karakter.`);
const clientId = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
const seq = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const supportCustomerMessageSchema = z.object({
  body, clientId,
  pagePath: z.string().max(300).regex(/^\/(?!\/)/).nullish(),
}).strict();
export const supportStaffMessageSchema = z.object({ body, clientId }).strict();
export const supportReadSchema = z.object({ seq }).strict();
export const supportConversationRefSchema = z.object({ conversationId: entityId }).strict();
export const supportCustomerReadSchema = supportConversationRefSchema.extend({ seq }).strict();
export const supportStatusSchema = z.object({ status: z.enum(SUPPORT_STATUSES) }).strict();
export const supportInboxQuerySchema = z.object({ status: z.enum(SUPPORT_STATUSES).default("open") });
export const supportMessagesQuerySchema = z.object({ after: seq.optional(), before: seq.optional() });

export const supportSettingsSchema = z.object({
  enabled: z.boolean(),
  teamName: z.string().trim().min(1, "Pencere başlığını yazın.").max(60, "En fazla 60 karakter."),
  welcomeMessage: z.string().trim().min(1, "Karşılama mesajını yazın.").max(300, "En fazla 300 karakter."),
  offlineMessage: z.string().trim().min(1, "Çevrimdışı mesajını yazın.").max(300, "En fazla 300 karakter."),
  expectedUpdatedAt: z.string().min(1),
}).strict();

/** GraphQL subscription over SSE: the operation travels in the URL (EventSource can only GET). */
export const supportStreamQuerySchema = z.object({
  query: z.string().min(1).max(2_000),
  variables: z.string().max(2_000).optional(),
});
