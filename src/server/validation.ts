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

export const adminOrderQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().max(40).optional(),
  paymentStatus: z.string().max(40).optional(),
  provider: z.enum(["iyzico", "bank_transfer"]).optional(),
  from: z.string().max(30).optional(),
  to: z.string().max(30).optional(),
  minTotal: z.coerce.number().int().min(0).optional(),
  maxTotal: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["placed_at", "total_minor", "order_number", "status"]).default("placed_at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});

const slug = z
  .string()
  .trim()
  .min(2)
  .max(160)
  .regex(/^[a-z0-9-]+$/, "Slug sadece küçük harf, rakam ve tire içerebilir.");

export const adminCategoryCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: slug.optional(),
  parentId: id.optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
  sortOrder: z.coerce.number().int().min(-100000).max(100000).default(0),
  isActive: z.boolean().default(true),
}).strict();

export const adminCategoryUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    slug: slug.optional(),
    parentId: id.optional().nullable(),
    description: z.string().trim().max(1000).optional().nullable(),
    sortOrder: z.coerce.number().int().min(-100000).max(100000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "En az bir alan güncellenmelidir.");
