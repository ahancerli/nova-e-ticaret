import { ConfigToken } from "@/core";
import { ExpireStaleCheckoutsToken } from "@/modules/checkout";
import { assertCronRequest } from "@/modules/platform/cron";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * Releases expired reservations, campaign allocations and coupons; cancels unpaid orders.
 * Call every few minutes with: Authorization: Bearer <CRON_SECRET>
 * (the scheduler container, scripts/scheduler.mjs — see README).
 */
export const POST = route({
  csrf: "none",
  handle: async ({ req, resolve }) => {
    assertCronRequest(req, resolve(ConfigToken).cronSecret);
    return resolve(ExpireStaleCheckoutsToken).execute();
  },
});
