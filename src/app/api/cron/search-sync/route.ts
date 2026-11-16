import { ConfigToken } from "@/core";
import { assertCronRequest } from "@/modules/platform/cron";
import { SyncSearchIndexToken } from "@/modules/search";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * Keeps the search index (Meilisearch) equal to the published catalog: changed products since the last run, new
 * synonym settings, and a full rebuild when the index is empty or a day old. `?full=1` forces the rebuild.
 * Without MEILI_URL it answers `not_configured`. Call every minute with: Authorization: Bearer <CRON_SECRET>.
 */
export const POST = route({
  csrf: "none",
  handle: async ({ req, resolve }) => {
    assertCronRequest(req, resolve(ConfigToken).cronSecret);
    return resolve(SyncSearchIndexToken).execute({ full: new URL(req.url).searchParams.get("full") === "1" });
  },
});
