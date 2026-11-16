import { reply } from "@/core";
import { ListSizeChartsToken, SaveSizeChartToken, sizeChartSchema } from "@/modules/size-charts";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "catalog.write" },
  handle: (ctx) => ctx.resolve(ListSizeChartsToken).execute(),
});

export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: sizeChartSchema,
  handle: async (ctx) => reply.created(await ctx.resolve(SaveSizeChartToken).execute(null, ctx.body, actorOf(ctx))),
});
