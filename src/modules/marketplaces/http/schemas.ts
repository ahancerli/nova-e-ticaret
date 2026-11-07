import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { MARKETPLACE_KEYS, type MarketplaceProvider } from "../domain/marketplace";

const minutes = (allowed: readonly number[]) => z.number().int().refine((n) => allowed.includes(n), "Geçersiz aralık.");

export const connectionSaveSchema = z.object({
  provider: z.enum(MARKETPLACE_KEYS as [MarketplaceProvider, ...MarketplaceProvider[]]),
  name: z.string().trim().min(2).max(80),
  environment: z.enum(["production", "stage"]),
  sellerId: z.string().trim().min(1).max(40).regex(/^[0-9A-Za-z_-]+$/, "Satıcı ID yalnız harf, rakam, tire."),
  apiKey: z.string().trim().max(200).nullable().optional(),
  apiSecret: z.string().trim().max(200).nullable().optional(),
  settings: z.object({
    cargoCompanyId: z.number().int().positive().nullable(),
    deliveryDuration: z.number().int().min(0).max(30),
    shipmentAddressId: z.number().int().positive().nullable(),
    returningAddressId: z.number().int().positive().nullable(),
    priceAdjustPct: z.number().min(-50).max(300),
    stockBuffer: z.number().int().min(0).max(10_000),
    useCompareAtAsListPrice: z.boolean(),
  }).strict(),
  intervals: z.object({
    orders: minutes([1, 5, 10, 15, 30, 60]), stock: minutes([1, 5, 10, 15, 30, 60]), price: minutes([1, 5, 10, 15, 30, 60]),
    content: minutes([5, 15, 30, 60, 180, 360, 720, 1440]),
  }).strict(),
  isActive: z.boolean(),
  expectedUpdatedAt: z.string().max(40).optional(),
}).strict();

export const categoryMappingSchema = z.object({ categoryId: entityId, external: z.object({ id: z.number().int().positive(), path: z.string().trim().min(1).max(500) }).strict().nullable() }).strict();
export const brandMappingSchema = z.object({ brandId: entityId, external: z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(200) }).strict().nullable() }).strict();
export const attributeMappingSchema = z.object({
  externalCategoryId: z.number().int().positive(),
  rules: z.array(z.object({
    externalAttributeId: z.number().int().positive(), name: z.string().trim().min(1).max(200),
    attributeId: entityId.nullable(), fixedValueId: z.number().int().positive().nullable(), fixedCustomValue: z.string().trim().min(1).max(200).nullable(),
  }).strict().refine((r) => [r.attributeId, r.fixedValueId, r.fixedCustomValue].filter((x) => x != null).length === 1, "Her özellik için tek bir kaynak seçin.")).max(200),
  values: z.array(z.object({
    externalAttributeId: z.number().int().positive(), optionId: entityId, valueId: z.number().int().positive().nullable(), custom: z.string().trim().min(1).max(200).nullable(),
  }).strict().refine((v) => (v.valueId == null) !== (v.custom == null), "Değer için Trendyol değeri veya serbest metin.")).max(2000),
}).strict();
export const listingsAddSchema = z.object({ productIds: z.array(entityId).min(1).max(500) }).strict();
export const listingsPauseSchema = z.object({ variantIds: z.array(entityId).min(1).max(1000), paused: z.boolean() }).strict();
export const syncSchema = z.object({ tasks: z.array(z.enum(["orders", "stock", "price", "content"])).min(1).max(4), resync: z.array(z.enum(["content", "stock", "price"])).max(3).optional() }).strict();
