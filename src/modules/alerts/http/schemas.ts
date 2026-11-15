import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";
import { ALERT_KINDS, type AlertKind } from "../domain/alert";

const kinds = Object.keys(ALERT_KINDS) as [AlertKind, ...AlertKind[]];

export const productAlertSubscribeSchema = z.object({
  variantId: entityId,
  kind: z.enum(kinds, "Geçersiz talep türü."),
}).strict();

export const productAlertQuerySchema = z.object({ productId: entityId.optional() });
