import { GetDeliverySettingsToken, UpdateDeliverySettingsToken, deliverySettingsSchema } from "@/modules/delivery";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "settings.write" },
  handle: (ctx) => ctx.resolve(GetDeliverySettingsToken).execute(),
});

/** PUT — "Bugün sipariş verirsen yarın kargoda" rules (optimistic concurrency on `expectedUpdatedAt`). */
export const PUT = route({
  auth: { audience: "admin", permission: "settings.write" },
  body: deliverySettingsSchema,
  handle: (ctx) => ctx.resolve(UpdateDeliverySettingsToken).execute(ctx.body, actorOf(ctx)),
});
