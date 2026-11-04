import { z } from "zod";
import { ConfigToken } from "@/core";
import { assertCronRequest } from "@/modules/platform/cron";
import { SyncCarrierTrackingToken } from "@/modules/shipping";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * Polls the active cargo firm for booked parcels: tracking numbers, in transit / delivered (Yurtiçi has no webhooks).
 * Call every 15–30 minutes with: Authorization: Bearer <CRON_SECRET>   (optional ?limit=1..200)
 */
export const POST = route({
  csrf: "none",
  query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
  handle: async ({ req, query, resolve }) => {
    assertCronRequest(req, resolve(ConfigToken).cronSecret);
    return resolve(SyncCarrierTrackingToken).execute(query.limit);
  },
});
