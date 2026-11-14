import { reply } from "@/core";
import { CreateAddressToken, ListAddressesToken, addressInputSchema } from "@/modules/addresses";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — Hesabım › Adreslerim (also the checkout address picker). */
export const GET = route({
  auth: { audience: "storefront", required: true },
  handle: (ctx) => ctx.resolve(ListAddressesToken).execute(actorOf(ctx).userId),
});

export const POST = route({
  auth: { audience: "storefront", required: true },
  body: addressInputSchema,
  rateLimit: { name: "address", limit: 30, windowSec: 3600 },
  handle: async (ctx) => reply.created(await ctx.resolve(CreateAddressToken).execute(ctx.body, actorOf(ctx))),
});
