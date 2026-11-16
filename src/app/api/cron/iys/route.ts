import { ConfigToken } from "@/core";
import { SyncIysToken } from "@/modules/iys";
import { assertCronRequest } from "@/modules/platform/cron";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** Sends queued consents to İYS and pulls changes made there. Every 5 minutes: Authorization: Bearer <CRON_SECRET>. */
export const POST = route({
  csrf: "none",
  handle: async ({ req, resolve }) => {
    assertCronRequest(req, resolve(ConfigToken).cronSecret);
    return resolve(SyncIysToken).execute();
  },
});
