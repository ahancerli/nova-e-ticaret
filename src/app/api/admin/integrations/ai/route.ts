import { GetAiIntegrationToken, RemoveAiIntegrationToken, SaveAiIntegrationToken, aiIntegrationDeleteSchema, aiIntegrationSchema } from "@/modules/ai";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/integrations/ai — the configured provider (`null` when none); the key is never returned. */
export const GET = route({
  auth: { audience: "admin", permission: "integrations.write" },
  handle: ({ resolve }) => resolve(GetAiIntegrationToken).execute(),
});

/** PUT — choose provider + model (+ key); replaces any other provider. `expectedUpdatedAt` guards concurrent edits (409). */
export const PUT = route({
  auth: { audience: "admin", permission: "integrations.write" },
  body: aiIntegrationSchema,
  handle: (ctx) => ctx.resolve(SaveAiIntegrationToken).execute(ctx.body, actorOf(ctx)),
});

export const DELETE = route({
  auth: { audience: "admin", permission: "integrations.write" },
  body: aiIntegrationDeleteSchema,
  handle: async (ctx) => {
    await ctx.resolve(RemoveAiIntegrationToken).execute(ctx.body.expectedUpdatedAt, actorOf(ctx));
    return { removed: true };
  },
});
