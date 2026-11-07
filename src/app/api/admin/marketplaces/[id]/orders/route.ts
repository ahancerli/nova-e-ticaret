import { z } from "zod";
import { MarketplaceListingsToken } from "@/modules/marketplaces";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — packages pulled from the marketplace and what happened to them (imported / failed / skipped). */
export const GET = route({
  auth: { audience: "admin", permission: "integrations.write" }, params: idParams, query: z.object({ status: z.enum(["imported", "failed", "skipped"]).optional() }),
  handle: ({ params, query, resolve }) => resolve(MarketplaceListingsToken).orders(params.id, query.status ?? null),
});
