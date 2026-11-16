import { ConfigToken } from "@/core";
import { assertCronRequest } from "@/modules/platform/cron";
import { ProcessDueConversationsToken } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * Safety net of the Social AI bot: answers conversations whose reply is due but was not produced by the webhook's own
 * after-response timer (restart, crash, AI retry). Call every 20 s with: Authorization: Bearer <CRON_SECRET>.
 */
export const POST = route({
  csrf: "none",
  handle: async ({ req, resolve }) => {
    assertCronRequest(req, resolve(ConfigToken).cronSecret);
    return resolve(ProcessDueConversationsToken).execute();
  },
});
