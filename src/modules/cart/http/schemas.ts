import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { MAX_LINE_QTY } from "../domain/cart";

export const addCartItemSchema = z.object({
  variantId: entityId,
  quantity: z.number().int().min(1).max(MAX_LINE_QTY),
}).strict();

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(MAX_LINE_QTY),
  /** Cart version the client last saw (meta.version of GET /api/cart). */
  version: z.number().int().min(0).optional(),
}).strict();

export const couponSchema = z.object({ code: z.string().trim().min(3).max(40) }).strict();
