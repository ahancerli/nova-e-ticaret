import { GenerateProductContentToken, aiProductGenerateSchema } from "@/modules/ai";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/ai/product-content — "AI ile ürün ekle": selected fields + 1–2 uploaded photos + a short
 * description → a draft for the product form (nothing is saved). Paid provider call → per-IP limit.
 */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  rateLimit: { name: "ai-generate", limit: 10, windowSec: 60 },
  body: aiProductGenerateSchema,
  handle: (ctx) => ctx.resolve(GenerateProductContentToken).execute(ctx.body, actorOf(ctx)),
});
