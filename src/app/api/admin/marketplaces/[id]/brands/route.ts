import { z } from "zod";
import { MarketplaceReferenceToken } from "@/modules/marketplaces";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET ?q= — marketplace brands by name. */
export const GET = route({
  auth: { audience: "admin", permission: "integrations.write" }, params: idParams, query: z.object({ q: z.string().max(100).default("") }),
  handle: ({ params, query, resolve }) => resolve(MarketplaceReferenceToken).brands(params.id, query.q),
});
