import { ConfigToken } from "@/core";
import { DispatchProductAlertsToken } from "@/modules/alerts";
import { assertCronRequest } from "@/modules/platform/cron";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * E-mails "Stok gelince / Fiyat düşünce haber ver" alerts whose condition holds (shop SMTP account).
 * Call every few minutes with: Authorization: Bearer <CRON_SECRET> (scripts/scheduler.mjs).
 */
export const POST = route({
  csrf: "none",
  handle: async ({ req, resolve }) => {
    assertCronRequest(req, resolve(ConfigToken).cronSecret);
    return resolve(DispatchProductAlertsToken).execute();
  },
});
