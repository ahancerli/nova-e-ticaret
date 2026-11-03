import { TestAiIntegrationToken } from "@/modules/ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/admin/integrations/ai/test — one tiny request with the stored key and model. */
export const POST = route({
  auth: { audience: "admin", permission: "integrations.write" },
  rateLimit: { name: "ai-test", limit: 5, windowSec: 60 },
  handle: ({ resolve }) => resolve(TestAiIntegrationToken).execute(),
});
