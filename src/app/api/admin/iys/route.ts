import { GetIysOverviewToken, SaveIysSettingsToken, iysSettingsSchema } from "@/modules/iys";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — İYS connection (no password), queue counts and the latest rows. */
export const GET = route({
  auth: { audience: "admin", permission: "integrations.write" },
  handle: (ctx) => ctx.resolve(GetIysOverviewToken).execute(),
});

/** PUT — save the İYS connection; switching on signs in first. */
export const PUT = route({
  auth: { audience: "admin", permission: "integrations.write" },
  body: iysSettingsSchema,
  handle: (ctx) => ctx.resolve(SaveIysSettingsToken).execute(ctx.body, actorOf(ctx)),
});
