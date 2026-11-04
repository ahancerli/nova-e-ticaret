import { SendTestMailToken } from "@/modules/mail";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/admin/integrations/mail/test — sends a test e-mail to the signed-in admin with the stored settings. */
export const POST = route({
  auth: { audience: "admin", permission: "integrations.write" },
  rateLimit: { name: "mail-test", limit: 5, windowSec: 60 },
  handle: (ctx) => ctx.resolve(SendTestMailToken).execute({ ...actorOf(ctx), email: ctx.user!.email, displayName: ctx.user!.displayName }),
});
