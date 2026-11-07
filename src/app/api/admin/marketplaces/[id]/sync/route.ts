import { MarketplaceListingsToken, RunMarketplaceSyncToken, syncSchema } from "@/modules/marketplaces";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — "Şimdi senkronize et": chosen tasks of this connection now (optionally re-queueing everything first). */
export const POST = route({
  auth: { audience: "admin", permission: "integrations.write" }, params: idParams, body: syncSchema,
  rateLimit: { name: "marketplace_sync", limit: 20, windowSec: 60 },
  handle: async ({ params, body, resolve }) => {
    if (body.resync?.length) await resolve(MarketplaceListingsToken).resync(params.id, body.resync);
    return resolve(RunMarketplaceSyncToken).execute(params.id, body.tasks);
  },
});
