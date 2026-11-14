import { SignalCustomerTypingToken, supportConversationRefSchema } from "@/modules/support";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — "yazıyor…" signal to staff (not stored; the widget sends at most one every few seconds). */
export const POST = route({
  auth: { audience: "storefront", required: true },
  rateLimit: { name: "support-typing", limit: 30, windowSec: 60 },
  body: supportConversationRefSchema,
  handle: (ctx) => ctx.resolve(SignalCustomerTypingToken).execute(ctx.body.conversationId, actorOf(ctx)),
});
