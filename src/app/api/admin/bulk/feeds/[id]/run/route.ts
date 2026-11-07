import { RunFeedSliceToken } from "@/modules/bulk";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/admin/bulk/feeds/:id/run — one slice of a sync; the panel calls it until `done` (progress bar). */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  params: idParams,
  rateLimit: { name: "feed_run", limit: 120, windowSec: 60 },
  handle: (ctx) => ctx.resolve(RunFeedSliceToken).execute(ctx.params.id, { ...actorOf(ctx), canPublish: ctx.user!.permissions.has("catalog.publish") }),
});
