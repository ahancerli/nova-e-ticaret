import { ConfigToken } from "@/core";
import { RunDueFeedsToken } from "@/modules/bulk";
import { assertCronRequest } from "@/modules/platform/cron";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * Syncs scheduled product feeds (XML / REST) whose next run is due, slice by slice within ~20 s; an unfinished pass
 * continues on the next call. Call every 10–15 minutes with: Authorization: Bearer <CRON_SECRET>
 */
export const POST = route({
  csrf: "none",
  handle: async ({ req, resolve }) => {
    assertCronRequest(req, resolve(ConfigToken).cronSecret);
    return resolve(RunDueFeedsToken).execute(20_000);
  },
});
