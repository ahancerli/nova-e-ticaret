import { ManageSearchToken } from "@/modules/search";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/admin/search/reindex — rebuild the whole index now (fresh index + atomic swap) and report the document count. */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  rateLimit: { name: "search-reindex", limit: 6, windowSec: 10 * 60 },
  handle: (ctx) => ctx.resolve(ManageSearchToken).reindex(actorOf(ctx)),
});
