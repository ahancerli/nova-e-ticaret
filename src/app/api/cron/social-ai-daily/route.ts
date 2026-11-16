import { ConfigToken } from "@/core";
import { assertCronRequest } from "@/modules/platform/cron";
import { RefreshChannelTokensToken, RunRetentionToken } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * Daily upkeep of Social AI Marketing: (1) 30-day retention — messages, tool calls and referrals older than 30 days
 * and conversations left empty are deleted for good (audit: row counts only); (2) Instagram tokens close to expiry
 * are renewed. Call once a day with: Authorization: Bearer <CRON_SECRET> (scripts/scheduler.mjs).
 */
export const POST = route({
  csrf: "none",
  handle: async ({ req, resolve }) => {
    assertCronRequest(req, resolve(ConfigToken).cronSecret);
    const retention = await resolve(RunRetentionToken).execute();
    const tokens = await resolve(RefreshChannelTokensToken).execute();
    return { retention, tokens };
  },
});
