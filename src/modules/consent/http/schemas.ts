import { z } from "zod";
import "@/modules/shared/schemas";
import {
  BANNER_LAYOUT_CODES, BANNER_TEXT_FIELDS, CONSENT_PROVIDER_CODES, CONSENT_SOURCES, GOOGLE_CONSENT_MODE_CODES, isRevision, isVisitorId,
  type BannerLayout, type BannerTextKey, type ConsentProviderCode, type ConsentSource, type GoogleConsentMode,
} from "../domain/consent";

const tuple = <T extends string>(v: readonly T[]) => v as unknown as [T, ...T[]];

const texts = z.object(
  Object.fromEntries(Object.entries(BANNER_TEXT_FIELDS).map(([k, f]) => [k, z.string().trim().max(f.max, `${f.label} en fazla ${f.max} karakter olabilir.`).optional()])) as
    Record<BannerTextKey, z.ZodOptional<z.ZodString>>,
).strict();

export const consentSettingsSchema = z.object({
  bannerEnabled: z.boolean(),
  provider: z.enum(tuple<ConsentProviderCode>(CONSENT_PROVIDER_CODES)),
  providerConfig: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), z.string().trim().max(200)).refine((v) => Object.keys(v).length <= 10, "Çok fazla alan."),
  layout: z.enum(tuple<BannerLayout>(BANNER_LAYOUT_CODES)),
  texts,
  googleConsentMode: z.enum(tuple<GoogleConsentMode>(GOOGLE_CONSENT_MODE_CODES)),
  maxAgeDays: z.number().int().min(30, "En az 30 gün.").max(395, "En fazla 395 gün (13 ay)."),
  expectedUpdatedAt: z.string().min(1).max(40),
}).strict();

export const tagCodeParams = z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "Geçersiz etiket.") });

export const trackingTagSaveSchema = z.object({
  isActive: z.boolean(),
  config: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), z.string().max(200)).refine((v) => Object.keys(v).length <= 10, "Çok fazla alan."),
  secrets: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/), z.string().max(600).nullable()).refine((v) => Object.keys(v).length <= 5, "Çok fazla alan.").optional(),
  expectedUpdatedAt: z.string().max(40).nullable(),
}).strict();

export const trackingTagDeleteSchema = z.object({ expectedUpdatedAt: z.string().min(1).max(40) }).strict();

/** Public: the browser reports a choice it already applied. */
export const consentRecordSchema = z.object({
  visitorId: z.string().refine(isVisitorId, "Geçersiz ziyaretçi."),
  revision: z.string().max(20).refine(isRevision, "Geçersiz revizyon."),
  choices: z.object({ functional: z.boolean(), analytics: z.boolean(), marketing: z.boolean() }).strict(),
  source: z.enum(tuple<ConsentSource>(CONSENT_SOURCES)),
}).strict();

export const consentRecordsQuery = z.object({
  ziyaretci: z.string().trim().max(64).optional().transform((v) => v || undefined),
  sayfa: z.coerce.number().int().min(1).max(10_000).default(1),
  boyut: z.coerce.number().int().min(10).max(100).default(25),
});
