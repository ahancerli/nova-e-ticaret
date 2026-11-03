import { reply } from "@/core";
import { CreateCampaignToken, ListCampaignsToken, campaignCreateSchema } from "@/modules/campaigns";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "campaigns.write" },
  handle: async ({ resolve }) => {
    const rows = await resolve(ListCampaignsToken).execute();
    return reply.ok(rows, { total: rows.length });
  },
});

export const POST = route({
  auth: { audience: "admin", permission: "campaigns.write" },
  body: campaignCreateSchema,
  bodyLimit: 128 * 1024,
  handle: async (ctx) => reply.created(await ctx.resolve(CreateCampaignToken).execute(ctx.body, actorOf(ctx))),
});
