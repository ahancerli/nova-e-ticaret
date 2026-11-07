import { ConfigToken } from "@/core";
import { RunIntegrationsToken } from "@/modules/marketplaces";
import { assertCronRequest } from "@/modules/platform/cron";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * Integration heartbeat — call EVERY MINUTE with: Authorization: Bearer <CRON_SECRET>
 *   1. catalog changes (triggers) → Kafka topics catalog.product-info / stock / price / images
 *   2. Kafka → per-marketplace work queues
 *   3. each connection's due tasks at its own intervals (orders pull, stock, price, product info)
 *   4. pulled orders from Kafka → order system (exactly once per package)
 */
export const POST = route({
  csrf: "none",
  handle: async ({ req, resolve }) => {
    assertCronRequest(req, resolve(ConfigToken).cronSecret);
    return resolve(RunIntegrationsToken).execute(25_000);
  },
});
