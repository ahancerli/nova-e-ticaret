import { z } from "zod";
import { MarketplaceReferenceToken } from "@/modules/marketplaces";
import { entityId } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — allowed values of a marketplace attribute in a category. */
export const GET = route({
  auth: { audience: "admin", permission: "integrations.write" },
  params: z.object({ id: entityId, extId: z.coerce.number().int().positive(), attrId: z.coerce.number().int().positive() }),
  handle: ({ params, resolve }) => resolve(MarketplaceReferenceToken).values(params.id, params.extId, params.attrId),
});
