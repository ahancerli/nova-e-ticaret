import {
  GetIntegrationPageToken, RemoveIntegrationToken, SaveIntegrationToken, integrationDeleteSchema, integrationKindParams, integrationSaveSchema,
} from "@/modules/integrations";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/integrations/:kind (sms | shipping) — firm catalog + the configured integration (no secret values). */
export const GET = route({
  auth: { audience: "admin", permission: "integrations.write" },
  params: integrationKindParams,
  handle: ({ params, resolve }) => resolve(GetIntegrationPageToken).execute(params.kind),
});

/** PUT — connect / update. A firm without an adapter → 409 provider_not_integrated; empty secret keeps the stored one. */
export const PUT = route({
  auth: { audience: "admin", permission: "integrations.write" },
  params: integrationKindParams,
  body: integrationSaveSchema,
  handle: (ctx) => ctx.resolve(SaveIntegrationToken).execute(ctx.params.kind, ctx.body, actorOf(ctx)),
});

export const DELETE = route({
  auth: { audience: "admin", permission: "integrations.write" },
  params: integrationKindParams,
  body: integrationDeleteSchema,
  handle: async (ctx) => {
    await ctx.resolve(RemoveIntegrationToken).execute(ctx.params.kind, ctx.body.expectedUpdatedAt, actorOf(ctx));
    return { removed: true };
  },
});
