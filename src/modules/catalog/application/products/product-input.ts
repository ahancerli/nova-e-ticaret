import { z } from "zod";
import { entityId, slugInput } from "@/modules/shared/schemas";

/** Input contract of the product save use case (create + update): the whole aggregate in one payload. */

const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const optInt = (min: number, max: number) => z.number().int().min(min).max(max).optional().nullable();

const variantInput = z
  .object({
    id: entityId.optional(),
    sku: z.string().trim().min(1, "SKU gerekli.").max(64).regex(/^[A-Za-z0-9._-]+$/, "SKU harf, rakam, nokta, tire ve alt çizgi içerebilir."),
    barcode: z.string().trim().max(32).regex(/^[0-9A-Za-z-]*$/, "Geçersiz barkod.").optional().nullable(),
    name: optText(120),
    options: z.record(entityId, entityId).default({}),
    priceMinor: z.number().int().min(0).max(1_000_000_000),
    compareAtMinor: z.number().int().min(1).max(1_000_000_000).optional().nullable(),
    /** Floor price: campaigns never sell a unit below it. */
    minPriceMinor: z.number().int().min(0).max(1_000_000_000).optional().nullable(),
    stock: z.number().int().min(0).max(1_000_000),
    /** Existing variants: the stock the editor loaded. Unchanged stock is not written; changed stock is guarded on it. */
    expectedStock: z.number().int().min(0).max(1_000_000).optional(),
    isActive: z.boolean(),
    isDefault: z.boolean(),
    weightGrams: optInt(0, 10_000_000),
    widthMm: optInt(0, 100_000),
    heightMm: optInt(0, 100_000),
    depthMm: optInt(0, 100_000),
    /** The variant's own photos (Renk: every size of a colour shares them). */
    media: z.array(entityId).max(20).default([]),
  })
  .strict()
  .refine((v) => v.compareAtMinor == null || v.compareAtMinor > v.priceMinor, { path: ["compareAtMinor"], message: "Eski fiyat, satış fiyatından büyük olmalı." })
  .refine((v) => v.minPriceMinor == null || v.minPriceMinor <= v.priceMinor, { path: ["minPriceMinor"], message: "Taban fiyat, satış fiyatından büyük olamaz." });

export const productSaveSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    slug: slugInput.optional(),
    status: z.enum(["draft", "in_review", "published", "paused", "archived"]),
    shortDescription: optText(300),
    descriptionHtml: optText(50_000),
    taxRateBps: z.number().int().min(0).max(10000),
    warrantyMonths: optInt(0, 600),
    countryOfOrigin: z.string().trim().regex(/^[A-Za-z]{2}$/, "İki harfli ülke kodu girin (örn. TR).").optional().nullable().or(z.literal("")),
    accountingCode: optText(64),
    manufacturerCode: optText(64),
    modelCode: z.string().trim().max(64).regex(/^[A-Za-z0-9._-]*$/, "Model kodu harf, rakam, nokta, tire ve alt çizgi içerebilir.").optional().nullable(),
    brandId: entityId.optional().nullable(),
    categories: z.array(z.object({ id: entityId, primary: z.boolean() }).strict()).max(20),
    media: z.array(entityId).max(30),
    primaryMediaId: entityId.optional().nullable(),
    axes: z.array(entityId).max(4),
    variants: z.array(variantInput).min(1, "En az bir varyant gerekli.").max(200),
    attributes: z.array(z.object({ attributeId: entityId, values: z.array(z.union([z.string().trim().max(500), z.number(), z.boolean()])).max(30) }).strict()).max(100),
    seo: z.object({
      metaTitle: optText(120),
      metaDescription: optText(320),
      canonicalUrl: z.string().trim().max(500).regex(/^(https:\/\/|\/)/, "https:// veya / ile başlamalı.").optional().nullable().or(z.literal("")),
      noindex: z.boolean(),
    }).strict(),
    /** Optimistic concurrency (update only): the `updatedAt` the editor loaded. A newer stored row → 409. */
    expectedUpdatedAt: z.iso.datetime().optional(),
  })
  .strict();

export type ProductInput = z.output<typeof productSaveSchema>;
export type VariantInput = ProductInput["variants"][number];
