import { PreviewFeedToken, feedPreviewSchema } from "@/modules/bulk";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/admin/bulk/feeds/preview — what a sync would do with the first items (nothing written). */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: feedPreviewSchema,
  bodyLimit: 64 * 1024,
  rateLimit: { name: "feed_fetch", limit: 20, windowSec: 60 },
  handle: (ctx) => ctx.resolve(PreviewFeedToken).execute(ctx.body, { ...actorOf(ctx), canPublish: ctx.user!.permissions.has("catalog.publish") }),
});
