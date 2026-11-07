import { z } from "zod";
import { MarketplaceReferenceToken } from "@/modules/marketplaces";
import { entityId } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — attributes of a marketplace category (required / variant / custom allowed). */
export const GET = route({
  auth: { audience: "admin", permission: "integrations.write" }, params: z.object({ id: entityId, extId: z.coerce.number().int().positive() }),
  handle: ({ params, resolve }) => resolve(MarketplaceReferenceToken).attributes(params.id, params.extId),
});
