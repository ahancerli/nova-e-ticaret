import { z } from "zod";
import { MarketplaceListingsToken, listingsAddSchema, listingsPauseSchema } from "@/modules/marketplaces";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";
const auth = { audience: "admin", permission: "integrations.write" } as const;

/** GET — listed variants; POST — list products (all active variants); PUT — pause / resume variants. */
export const GET = route({
  auth, params: idParams, query: z.object({ status: z.enum(["pending", "submitted", "approved", "rejected", "error", "paused"]).optional(), q: z.string().max(100).optional() }),
  handle: ({ params, query, resolve }) => resolve(MarketplaceListingsToken).list(params.id, query),
});

export const POST = route({
  auth, params: idParams, body: listingsAddSchema,
  handle: (ctx) => ctx.resolve(MarketplaceListingsToken).add(ctx.params.id, ctx.body.productIds, actorOf(ctx)),
});

export const PUT = route({
  auth, params: idParams, body: listingsPauseSchema,
  handle: async (ctx) => {
    await ctx.resolve(MarketplaceListingsToken).pause(ctx.params.id, ctx.body.variantIds, ctx.body.paused, actorOf(ctx));
    return { saved: true };
  },
});
