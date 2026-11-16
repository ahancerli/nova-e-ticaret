import { z } from "zod";
import { entityId } from "@/modules/shared/schemas";

export const wishlistAddSchema = z.object({ productId: entityId }).strict();
