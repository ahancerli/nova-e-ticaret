import { actorOf } from "@/modules/shared/actor";
import { SetConversationStatusToken, conversationStatusSchema, socialIdParams } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT — take over (`handoff`), give back to the bot (`bot`) or close (`closed`). */
export const PUT = route({
  auth: { audience: "admin", permission: "social_ai.chat" },
  params: socialIdParams,
  body: conversationStatusSchema,
  handle: async (ctx) => {
    await ctx.resolve(SetConversationStatusToken).execute(ctx.params.id, ctx.body.status, actorOf(ctx));
    return { status: ctx.body.status };
  },
});
