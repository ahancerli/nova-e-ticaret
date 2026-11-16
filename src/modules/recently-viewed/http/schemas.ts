import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";

export const recentViewSchema = z.object({ productId: entityId }).strict();
export const recentListQuery = z.object({ exclude: entityId.optional(), limit: z.coerce.number().int().min(1).max(16).optional() });
