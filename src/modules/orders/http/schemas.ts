import { z } from "zod";
import { entityId as id } from "@/modules/shared/schemas";

const ORDER_STATUSES = ["pending_payment", "awaiting_transfer", "paid", "preparing", "shipped", "delivered", "completed", "cancelled", "refunded", "partially_refunded"] as const;
const PAYMENT_STATUSES = ["unpaid", "pending", "paid", "failed", "refunded", "partially_refunded"] as const;
/** "a,b,c" → validated enum list (unknown values are rejected, not ignored). */
const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.string().max(300).transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)).pipe(z.array(z.enum(values)).max(values.length));

export const orderQuerySchema = z.object({
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
export const orderActionSchema = z.discriminatedUnion("action", [
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
export const orderBulkSchema = z.object({
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

/** Sipariş sorgula (guest): order number + the e-mail used at checkout. */
export const guestOrderLookupSchema = z.object({
  orderNumber: z.string().trim().min(4, "Sipariş numarasını girin.").max(40),
  email: z.email("Geçerli bir e-posta girin.").max(254),
}).strict();

export type OrderQuery = z.output<typeof orderQuerySchema>;
export type OrderActionInput = z.output<typeof orderActionSchema>;
export type BulkActionInput = z.output<typeof orderBulkSchema>["action"];
