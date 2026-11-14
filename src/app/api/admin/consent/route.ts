import { GetConsentAdminToken, UpdateConsentSettingsToken, consentSettingsSchema } from "@/modules/consent";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/consent — banner settings, configured tracking tags, current revision, last 30 days of choices. */
export const GET = route({
  auth: { audience: "admin", permission: "integrations.write" },
  handle: ({ resolve }) => resolve(GetConsentAdminToken).execute(),
});

/** PUT — banner settings. An external CMP without an adapter → 409 provider_not_integrated; `expectedUpdatedAt` guards edits (409). */
export const PUT = route({
  auth: { audience: "admin", permission: "integrations.write" },
  body: consentSettingsSchema,
  handle: (ctx) => ctx.resolve(UpdateConsentSettingsToken).execute(ctx.body, actorOf(ctx)),
});
