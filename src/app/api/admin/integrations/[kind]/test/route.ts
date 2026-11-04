import { TestIntegrationToken, integrationKindParams, integrationTestSchema } from "@/modules/integrations";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/admin/integrations/:kind/test — SMS: a test message to `phone`; cargo: credential check (nothing is created). */
export const POST = route({
  auth: { audience: "admin", permission: "integrations.write" },
  params: integrationKindParams,
  body: integrationTestSchema,
  rateLimit: { name: "integration-test", limit: 5, windowSec: 60 },
  handle: (ctx) => ctx.resolve(TestIntegrationToken).execute(ctx.params.kind, ctx.body),
});
