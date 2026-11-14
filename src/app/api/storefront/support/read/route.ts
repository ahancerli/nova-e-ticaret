import { MarkCustomerReadToken, supportCustomerReadSchema } from "@/modules/support";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — the member saw messages up to `seq` (clears their badge, shows "Görüldü" to staff). */
export const POST = route({
  auth: { audience: "storefront", required: true },
  rateLimit: { name: "support-read", limit: 60, windowSec: 60 },
  body: supportCustomerReadSchema,
  handle: (ctx) => ctx.resolve(MarkCustomerReadToken).execute(ctx.body.conversationId, ctx.body.seq, actorOf(ctx)),
});
