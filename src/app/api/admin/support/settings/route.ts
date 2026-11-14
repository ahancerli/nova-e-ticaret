import { GetSupportSettingsToken, UpdateSupportSettingsToken, supportSettingsSchema } from "@/modules/support";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: ["support.chat"] },
  handle: ({ resolve }) => resolve(GetSupportSettingsToken).execute(),
});

/** PUT — switch the module on / off, widget texts (`expectedUpdatedAt` → 409). */
export const PUT = route({
  auth: { audience: "admin", permission: "settings.write" },
  body: supportSettingsSchema,
  handle: (ctx) => ctx.resolve(UpdateSupportSettingsToken).execute(ctx.body, actorOf(ctx)),
});
