import { reply } from "@/core";
import { CreateReturnRequestToken, returnCreateSchema } from "@/modules/returns";
import { route } from "@/server/app";
import { returnIdentity } from "./identity";

export const dynamic = "force-dynamic";

/** POST — open a return (cancellation-right) request for delivered lines (header: Idempotency-Key). */
export const POST = route({
  auth: { audience: "storefront" },
  body: returnCreateSchema,
  rateLimit: { name: "return_create", limit: 10, windowSec: 3600 },
  idempotency: { scope: ({ user }) => `return.create:${user?.id ?? "guest"}` },
  handle: async (ctx) => reply.created(await ctx.resolve(CreateReturnRequestToken).execute(returnIdentity(ctx.user, ctx.body.email), ctx.body, ctx.requestId)),
});
