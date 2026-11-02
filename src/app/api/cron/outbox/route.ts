import { z } from "zod";
import { ConfigToken } from "@/core";
import { assertCronRequest } from "@/modules/platform/cron";
import { route } from "@/server/app";
import { ProcessOutboxToken } from "@/modules/outbox";

export const dynamic = "force-dynamic";

/**
 * Delivers pending outbox events (refunds → iyzico, shipments → carrier, notifications).
 * Call every minute with: Authorization: Bearer <CRON_SECRET>   (optional ?limit=1..100)
 */
export const POST = route({
  csrf: "none",
  query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }),
  handle: async ({ req, query, resolve }) => {
    assertCronRequest(req, resolve(ConfigToken).cronSecret);
    return resolve(ProcessOutboxToken).execute(query.limit);
  },
});
