import { TestIyzicoKeysToken, iyzicoTestSchema } from "@/modules/payments";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/admin/payments/iyzico/test — verifies the stored keys with a signed BIN lookup (no payment is created). */
export const POST = route({
  auth: { audience: "admin", permission: "payments.secrets" },
  body: iyzicoTestSchema,
  rateLimit: { name: "iyzico-test", limit: 5, windowSec: 60 },
  handle: (ctx) => ctx.resolve(TestIyzicoKeysToken).execute(ctx.body.environment),
});
