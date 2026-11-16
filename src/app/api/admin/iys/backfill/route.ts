import { BackfillIysToken } from "@/modules/iys";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — queue every current marketing consent never sent to İYS (go-live). */
export const POST = route({
  auth: { audience: "admin", permission: "integrations.write" },
  rateLimit: { name: "iys-backfill", limit: 5, windowSec: 60 * 60 },
  handle: (ctx) => ctx.resolve(BackfillIysToken).execute(actorOf(ctx)),
});
