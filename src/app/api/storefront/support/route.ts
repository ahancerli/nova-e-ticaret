import { GetCustomerSupportToken, supportMessagesQuerySchema } from "@/modules/support";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — the member's latest conversation + last page of messages; `?after=seq` = only newer ones (resync after reconnect). */
export const GET = route({
  auth: { audience: "storefront", required: true },
  query: supportMessagesQuerySchema,
  handle: (ctx) => ctx.resolve(GetCustomerSupportToken).execute(actorOf(ctx).userId, ctx.query.after),
});
