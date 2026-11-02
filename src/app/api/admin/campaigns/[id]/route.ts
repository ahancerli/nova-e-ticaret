import { NotFoundError } from "@/core";
import { DeleteCampaignToken, GetCampaignToken, UpdateCampaignToken, campaignUpdateSchema } from "@/modules/campaigns";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "campaigns.write" },
  params: idParams,
  handle: async ({ params, resolve }) => {
    const c = await resolve(GetCampaignToken).execute(params.id);
    if (!c) throw new NotFoundError("campaign_not_found", "Kampanya bulunamadı.");
    return c;
  },
});

/** PUT — full update with `expectedUpdatedAt` (409 campaign_changed when someone saved in between). */
export const PUT = route({
  auth: { audience: "admin", permission: "campaigns.write" },
  params: idParams,
  body: campaignUpdateSchema,
  bodyLimit: 128 * 1024,
  handle: (ctx) => ctx.resolve(UpdateCampaignToken).execute(ctx.params.id, ctx.body, actorOf(ctx)),
});

export const DELETE = route({
  auth: { audience: "admin", permission: "campaigns.write" },
  params: idParams,
  handle: async (ctx) => {
    await ctx.resolve(DeleteCampaignToken).execute(ctx.params.id, actorOf(ctx));
    return { deleted: true };
  },
});
