import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import {
  ADMIN_REVIEW_SORTS, BODY_MAX, BULK_MAX, CONTACT_CHANNELS, CONTACT_STATUSES, MODERATION_ACTIONS, MODERATION_MODES, PUBLIC_REVIEW_SORTS, REJECT_REASONS, REPLY_MAX,
  REVIEW_TABS, TITLE_MAX,
  type ContactChannel, type ContactStatus, type ModerationAction, type ModerationMode, type PublicReviewSort, type RejectReason, type ReviewTab,
} from "../domain/review";

const keys = <T extends object>(o: T) => Object.keys(o) as [Extract<keyof T, string>, ...Extract<keyof T, string>[]];
const rating = z.coerce.number().int().min(1, "1–5 arası puan verin.").max(5, "1–5 arası puan verin.");

export const slugParams = z.object({ slug: z.string().trim().min(1).max(160) });

export const reviewSubmitSchema = z.object({
  rating,
  title: z.string().trim().max(TITLE_MAX, `Başlık en fazla ${TITLE_MAX} karakter.`).nullable().optional(),
  body: z.string().trim().min(1, "Yorumunuzu yazın.").max(BODY_MAX, `Yorum en fazla ${BODY_MAX} karakter.`),
  isAnonymous: z.boolean().optional(),
}).strict();

export const reviewVoteSchema = z.object({ helpful: z.boolean() }).strict();

export const publicReviewQuerySchema = z.object({
  sort: z.enum(keys(PUBLIC_REVIEW_SORTS) as [PublicReviewSort, ...PublicReviewSort[]]).default("newest"),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

export const adminReviewQuerySchema = z.object({
  tab: z.enum(keys(REVIEW_TABS) as [ReviewTab, ...ReviewTab[]]).default("pending"),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  productId: entityId.optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(ADMIN_REVIEW_SORTS).default("created_at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const reviewModerateSchema = z.object({
  ids: z.array(entityId).min(1).max(BULK_MAX, `Tek seferde en fazla ${BULK_MAX} yorum.`),
  action: z.enum(keys(MODERATION_ACTIONS) as [ModerationAction, ...ModerationAction[]]),
  reason: z.enum(keys(REJECT_REASONS) as [RejectReason, ...RejectReason[]]).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
}).strict();

export const reviewReplySchema = z.object({ body: z.string().trim().max(REPLY_MAX, `Yanıt en fazla ${REPLY_MAX} karakter.`).nullable() }).strict();

const contactStatus = z.enum(keys(CONTACT_STATUSES) as [ContactStatus, ...ContactStatus[]]);

export const reviewContactSchema = z.object({
  channel: z.enum(keys(CONTACT_CHANNELS) as [ContactChannel, ...ContactChannel[]]),
  subject: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().min(1, "Mesajı yazın.").max(5000),
  contactStatus: contactStatus.optional(),
}).strict();

export const reviewContactStatusSchema = z.object({ contactStatus }).strict();

export const reviewSettingsSchema = z.object({
  moderationMode: z.enum(keys(MODERATION_MODES) as [ModerationMode, ...ModerationMode[]]),
  requirePurchase: z.boolean(),
  allowAnonymous: z.boolean(),
  minBodyLength: z.coerce.number().int().min(1).max(500),
  blockedWords: z.array(z.string().trim().min(2).max(40)).max(200),
  expectedUpdatedAt: z.string().min(1).max(40),
}).strict();
