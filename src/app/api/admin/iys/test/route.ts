import { TestIysToken } from "@/modules/iys";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const POST = route({
  auth: { audience: "admin", permission: "integrations.write" },
  rateLimit: { name: "iys-test", limit: 20, windowSec: 60 * 60 },
  handle: (ctx) => ctx.resolve(TestIysToken).execute(),
});
