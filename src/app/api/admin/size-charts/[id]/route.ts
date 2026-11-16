import { DeleteSizeChartToken, SaveSizeChartToken, sizeChartSchema } from "@/modules/size-charts";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const PUT = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  body: sizeChartSchema,
  handle: (ctx) => ctx.resolve(SaveSizeChartToken).execute(ctx.params.id, ctx.body, actorOf(ctx)),
});

export const DELETE = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  handle: (ctx) => ctx.resolve(DeleteSizeChartToken).execute(ctx.params.id, actorOf(ctx)),
});
