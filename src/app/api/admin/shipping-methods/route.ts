import { CreateShippingRateToken, ListShippingRatesToken, shippingRateSchema } from "@/modules/shipping";
import { actorOf } from "@/modules/shared/actor";
import { reply } from "@/core";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "settings.write" },
  handle: (ctx) => ctx.resolve(ListShippingRatesToken).execute(),
});

export const POST = route({
  auth: { audience: "admin", permission: "settings.write" },
  body: shippingRateSchema,
  handle: async (ctx) => reply.created(await ctx.resolve(CreateShippingRateToken).execute(ctx.body, actorOf(ctx))),
});
