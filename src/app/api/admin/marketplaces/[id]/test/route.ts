import { TestMarketplaceConnectionToken } from "@/modules/marketplaces";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — does the marketplace accept the stored keys? */
export const POST = route({
  auth: { audience: "admin", permission: "integrations.write" }, params: idParams,
  rateLimit: { name: "marketplace_test", limit: 10, windowSec: 60 },
  handle: ({ params, resolve }) => resolve(TestMarketplaceConnectionToken).execute(params.id),
});
