import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { RETURN_REASONS, RETURN_STATUSES } from "../domain/returns";

const orderRef = {
  orderNumber: z.string().trim().min(4).max(40),
  /** Guests prove the order with its e-mail; signed-in customers leave it out. */
  email: z.email("Geçerli bir e-posta girin.").max(254).optional(),
};

export const returnOptionsSchema = z.object(orderRef).strict();

export const returnCreateSchema = z.object({
  ...orderRef,
  reason: z.enum(Object.keys(RETURN_REASONS) as [keyof typeof RETURN_REASONS, ...(keyof typeof RETURN_REASONS)[]], { message: "İade nedenini seçin." }),
  note: z.string().trim().max(1000, "En fazla 1000 karakter.").optional(),
  items: z.array(z.object({ orderItemId: entityId, quantity: z.number().int().min(1).max(10_000) }).strict()).min(1, "İade edilecek en az bir ürün seçin.").max(100),
}).strict();
export type ReturnCreateInput = z.output<typeof returnCreateSchema>;

export const returnListSchema = z.object({
  status: z.enum(["all", ...Object.keys(RETURN_STATUSES)] as [string, ...string[]]).default("requested"),
});

export const returnDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), note: z.string().trim().max(1000).optional() }).strict(),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3, "Red nedenini yazın (müşteriye gönderilir).").max(500) }).strict(),
  z.object({ action: z.literal("receive") }).strict(),
  z.object({
    action: z.literal("refund"),
    amountMinor: z.number().int().min(1, "İade tutarı girin.").max(1_000_000_000),
    restock: z.boolean().default(true),
  }).strict(),
]);
export type ReturnDecision = z.output<typeof returnDecisionSchema>;
