import { ConfigToken } from "@/core";
import { RunInvoiceJobsToken } from "@/modules/invoices";
import { assertCronRequest } from "@/modules/platform/cron";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * Automatic invoicing: queues orders that reached the trigger and advances invoice jobs one integrator step each
 * (Paraşüt). Call every minute with: Authorization: Bearer <CRON_SECRET> (scripts/scheduler.mjs).
 */
export const POST = route({
  csrf: "none",
  handle: async ({ req, resolve }) => {
    assertCronRequest(req, resolve(ConfigToken).cronSecret);
    return resolve(RunInvoiceJobsToken).execute();
  },
});
