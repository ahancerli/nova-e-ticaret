import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { SUBSCRIBER_SORTS, SUBSCRIBER_TABS, type SubscriberTab } from "../domain/newsletter";

export const newsletterSubscribeSchema = z.object({
  email: z.email("Geçerli bir e-posta adresi girin.").trim().max(254),
  /** The KVKK / commercial message consent checkbox must be ticked. */
  consent: z.literal(true, "Ticari elektronik ileti onayını işaretleyin."),
}).strict();

export const newsletterConfirmSchema = z.object({ token: z.string().min(20).max(100) }).strict();
export const newsletterUnsubscribeSchema = z.object({ id: entityId, sig: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

export const subscriberQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  tab: z.enum(Object.keys(SUBSCRIBER_TABS) as [SubscriberTab, ...SubscriberTab[]]).default("all"),
  sort: z.enum(SUBSCRIBER_SORTS).default("created_at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
