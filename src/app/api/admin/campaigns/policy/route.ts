import { GetPricingPolicyToken, UpdatePricingPolicyToken, pricingPolicySchema } from "@/modules/campaigns";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET/PUT /api/admin/campaigns/policy — shop-wide campaign rules (conflict strategy, max discount share). */
export const GET = route({
  auth: { audience: "admin", permission: "campaigns.write" },
  handle: ({ resolve }) => resolve(GetPricingPolicyToken).execute(),
});

export const PUT = route({
  auth: { audience: "admin", permission: "campaigns.write" },
  body: pricingPolicySchema,
  handle: (ctx) => ctx.resolve(UpdatePricingPolicyToken).execute(ctx.body, actorOf(ctx)),
});
