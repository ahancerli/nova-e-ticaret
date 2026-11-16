import { actorOf } from "@/modules/shared/actor";
import { DisconnectChannelToken, GetChannelOverviewToken, UpdateChannelToken, channelUpdateSchema, socialChannelParams } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";
const auth = { audience: "admin", permission: "social_ai.manage" } as const;

/** GET — AI readiness, Meta app (no secrets), the connection and today's numbers of one channel. */
export const GET = route({ auth, params: socialChannelParams, handle: (ctx) => ctx.resolve(GetChannelOverviewToken).execute(ctx.params.channel) });

/** PUT — bot on / off and the channel's own welcome message. */
export const PUT = route({
  auth, params: socialChannelParams, body: channelUpdateSchema,
  handle: (ctx) => ctx.resolve(UpdateChannelToken).execute(ctx.params.channel, ctx.body, actorOf(ctx)),
});

/** DELETE — disconnect: the token is deleted, the webhook subscription removed at Meta. */
export const DELETE = route({
  auth, params: socialChannelParams,
  handle: async (ctx) => {
    await ctx.resolve(DisconnectChannelToken).execute(ctx.params.channel, actorOf(ctx));
    return { disconnected: true };
  },
});
