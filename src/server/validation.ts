import "server-only";
import { z } from "zod";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Geçersiz kimlik");
const phone = z.string().trim().regex(/^\+?[1-9]\d{9,14}$/, "Telefon +905xxxxxxxxx biçiminde olmalı");
const text = (max: number) => z.string().trim().min(1).max(max);

export const addCartItemSchema = z.object({
  variantId: id,
  quantity: z.number().int().min(1).max(20),
}).strict();

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(20),
  version: z.number().int().min(0).optional(),
}).strict();

export const couponSchema = z.object({ code: z.string().trim().min(3).max(40) }).strict();

const address = z.object({
  recipientName: text(120),
  phone,
  province: text(60),
  district: text(60),
  line1: text(250),
  line2: z.string().trim().max(250).optional(),
  postalCode: z.string().trim().max(10).optional(),
  companyName: z.string().trim().max(160).optional(),
  taxOffice: z.string().trim().max(80).optional(),
}).strict();

export const confirmSchema = z.object({
  checkoutId: id,
  paymentMethod: z.enum(["iyzico", "bank_transfer"]),
  email: z.email().max(254),
  phone,
  shipping: address,
  billing: address.optional(),
  note: z.string().trim().max(1000).optional(),
  acceptedTermsVersion: text(32),
}).strict();

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
}).strict();

const csv = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20) : []);

/** Parses /api/catalog/products query string. Unknown attr codes are ignored server-side. */
export function parseListQuery(sp: URLSearchParams) {
  const num = (k: string) => {
    const v = sp.get(k);
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
  };
  const attrs: Record<string, string[]> = {};
  for (const [k, v] of sp.entries()) {
    if (k.startsWith("a.") && /^a\.[a-z0-9_]{1,40}$/.test(k)) attrs[k.slice(2)] = csv(v);
  }
  return {
    category: sp.get("category")?.slice(0, 100) || undefined,
    brand: sp.get("brand")?.slice(0, 100) || undefined,
    q: sp.get("q")?.trim().slice(0, 100) || undefined,
    minPrice: num("minPrice"),
    maxPrice: num("maxPrice"),
    inStock: sp.get("inStock") === "1",
    sort: sp.get("sort") ?? "newest",
    page: Math.min(Math.max(num("page") ?? 1, 1), 500),
    attrs,
  };
}

const ORDER_STATUSES = ["pending_payment", "awaiting_transfer", "paid", "preparing", "shipped", "delivered", "completed", "cancelled", "refunded", "partially_refunded"] as const;
const PAYMENT_STATUSES = ["unpaid", "pending", "paid", "failed", "refunded", "partially_refunded"] as const;
/** "a,b,c" → validated enum list (unknown values are rejected, not ignored). */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.string().max(300).transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.enum(values)).max(values.length));

export const adminOrderQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: csvEnum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  provider: z.enum(["iyzico", "bank_transfer"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-AA-GG").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-AA-GG").optional(),
  minTotal: z.coerce.number().int().min(0).optional(),
  maxTotal: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["placed_at", "total_minor", "order_number", "status"]).default("placed_at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});

/** POST /api/admin/orders/:id/actions — one schema per state-machine action (lib/order-rules.ts). */
export const adminOrderActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), note: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal("complete"), note: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal("deliver"), note: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(3, "İptal sebebini yazın.").max(500) }).strict(),
  z.object({ action: z.literal("note"), note: z.string().trim().min(1, "Not boş olamaz.").max(1000) }).strict(),
  z.object({
    action: z.literal("reconcile"),
    receivedMinor: z.number().int().min(0).max(1_000_000_000),
    note: z.string().trim().max(500).optional(),
  }).strict(),
  z.object({
    action: z.literal("ship"),
    shippingMethodId: id,
    trackingNumber: z.string().trim().max(64).optional().nullable(),
    trackingUrl: z.string().trim().max(500).regex(/^https:\/\//, "Takip adresi https:// ile başlamalı.").optional().nullable().or(z.literal("")),
    // Omitted → every remaining unit is shipped (used by bulk shipping).
    items: z.array(z.object({ orderItemId: id, quantity: z.number().int().min(1).max(10_000) }).strict()).min(1).max(200).optional(),
  }).strict(),
  z.object({
    action: z.literal("refund"),
    amountMinor: z.number().int().min(1, "İade tutarı girin.").max(1_000_000_000),
    reason: z.string().trim().min(3, "İade sebebini yazın.").max(500),
    restock: z.array(z.object({ orderItemId: id, quantity: z.number().int().min(1).max(10_000) }).strict()).max(200).default([]),
  }).strict(),
]);

/** POST /api/admin/orders/bulk — same action payloads, applied to each selected order independently. */
export const adminOrderBulkSchema = z.object({
  orderIds: z.array(id).min(1, "En az bir sipariş seçin.").max(100, "Tek seferde en fazla 100 sipariş."),
  action: z.discriminatedUnion("action", [
    z.object({ action: z.literal("prepare") }).strict(),
    z.object({ action: z.literal("deliver") }).strict(),
    z.object({ action: z.literal("complete") }).strict(),
    z.object({ action: z.literal("cancel"), reason: z.string().trim().min(3).max(500) }).strict(),
    z.object({ action: z.literal("note"), note: z.string().trim().min(1).max(1000) }).strict(),
    z.object({ action: z.literal("ship"), shippingMethodId: id }).strict(),
  ]),
}).strict();

// Free text here; services run slugify() ("Bahçe Ürünleri" → "bahce-urunleri") and validate the result.
const slug = z.string().trim().min(1).max(160);

export const adminCategoryCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: slug.optional(),
  parentId: id.optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
  imageMediaId: id.optional().nullable(),
  menuMediaId: id.optional().nullable(),
  sortOrder: z.coerce.number().int().min(-100000).max(100000).default(0),
  isActive: z.boolean().default(true),
}).strict();

export const adminCategoryUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    slug: slug.optional(),
    parentId: id.optional().nullable(),
    description: z.string().trim().max(1000).optional().nullable(),
    imageMediaId: id.optional().nullable(),
    menuMediaId: id.optional().nullable(),
    sortOrder: z.coerce.number().int().min(-100000).max(100000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "En az bir alan güncellenmelidir.");

// ---------------------------------------------------------------------------
// Products: the editor saves the whole aggregate (product + categories + media + variants
// + prices + stock + attributes + SEO) in one request / one D1 batch.
// ---------------------------------------------------------------------------
const optText = (max: number) => z.string().trim().max(max).optional().nullable();
const optInt = (min: number, max: number) => z.number().int().min(min).max(max).optional().nullable();

const productVariantSchema = z
  .object({
    id: id.optional(),
    sku: z.string().trim().min(1, "SKU gerekli.").max(64).regex(/^[A-Za-z0-9._-]+$/, "SKU harf, rakam, nokta, tire ve alt çizgi içerebilir."),
    barcode: z.string().trim().max(32).regex(/^[0-9A-Za-z-]*$/, "Geçersiz barkod.").optional().nullable(),
    name: optText(120),
    options: z.record(id, id).default({}),
    priceMinor: z.number().int().min(0).max(1_000_000_000),
    compareAtMinor: z.number().int().min(1).max(1_000_000_000).optional().nullable(),
    stock: z.number().int().min(0).max(1_000_000),
    isActive: z.boolean(),
    isDefault: z.boolean(),
    weightGrams: optInt(0, 10_000_000),
    widthMm: optInt(0, 100_000),
    heightMm: optInt(0, 100_000),
    depthMm: optInt(0, 100_000),
  })
  .strict()
  .refine((v) => v.compareAtMinor == null || v.compareAtMinor > v.priceMinor, { path: ["compareAtMinor"], message: "Eski fiyat, satış fiyatından büyük olmalı." });

export const adminProductSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    slug: slug.optional(),
    status: z.enum(["draft", "in_review", "published", "paused", "archived"]),
    shortDescription: optText(300),
    descriptionHtml: optText(50_000),
    taxRateBps: z.number().int().min(0).max(10000),
    warrantyMonths: optInt(0, 600),
    countryOfOrigin: z.string().trim().regex(/^[A-Za-z]{2}$/, "İki harfli ülke kodu girin (örn. TR).").optional().nullable().or(z.literal("")),
    accountingCode: optText(64),
    manufacturerCode: optText(64),
    brandId: id.optional().nullable(),
    categories: z.array(z.object({ id, primary: z.boolean() }).strict()).max(20),
    media: z.array(id).max(30),
    primaryMediaId: id.optional().nullable(),
    axes: z.array(id).max(4),
    variants: z.array(productVariantSchema).min(1, "En az bir varyant gerekli.").max(200),
    attributes: z.array(z.object({ attributeId: id, values: z.array(z.union([z.string().trim().max(500), z.number(), z.boolean()])).max(30) }).strict()).max(100),
    seo: z.object({
      metaTitle: optText(120),
      metaDescription: optText(320),
      canonicalUrl: z.string().trim().max(500).regex(/^(https:\/\/|\/)/, "https:// veya / ile başlamalı.").optional().nullable().or(z.literal("")),
      noindex: z.boolean(),
    }).strict(),
  })
  .strict();

// brands.website_url CHECK: GLOB 'http*://*' → only absolute http(s) URLs.
const websiteUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname.includes(".");
    } catch {
      return false;
    }
  }, "Geçerli bir web adresi girin (https://…).");

const brandFields = {
  name: z.string().trim().min(1).max(160),
  slug: slug.optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  logoMediaId: id.optional().nullable(),
  bannerMediaId: id.optional().nullable(),
  websiteUrl: websiteUrl.optional().nullable(),
  isActive: z.boolean(),
};

export const adminBrandCreateSchema = z.object({ ...brandFields, isActive: brandFields.isActive.default(true) }).strict();

export const adminBrandUpdateSchema = z
  .object({ ...brandFields, name: brandFields.name.optional(), isActive: brandFields.isActive.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "En az bir alan güncellenmelidir.");
