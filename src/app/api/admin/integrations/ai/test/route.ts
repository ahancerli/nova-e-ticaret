import { TestAiIntegrationToken } from "@/modules/ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/admin/integrations/ai/test — health check: model lookup (free) + one tiny generation with the stored key. */
export const POST = route({
  auth: { audience: "admin", permission: "integrations.write" },
  rateLimit: { name: "ai-test", limit: 5, windowSec: 60 },
  handle: ({ resolve }) => resolve(TestAiIntegrationToken).execute(),
});
