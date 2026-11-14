import { reply } from "@/core";
import { SendCustomerMessageToken, supportCustomerMessageSchema } from "@/modules/support";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — write to support; starts a conversation when none is open. `clientId` makes a retried send a no-op. */
export const POST = route({
  auth: { audience: "storefront", required: true },
  rateLimit: { name: "support-message", limit: 30, windowSec: 60 },
  body: supportCustomerMessageSchema,
  bodyLimit: 8_192,
  handle: async (ctx) => reply.created(await ctx.resolve(SendCustomerMessageToken).execute(ctx.body, actorOf(ctx))),
});
