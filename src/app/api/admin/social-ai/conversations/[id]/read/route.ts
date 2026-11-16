import { MarkConversationReadToken, socialIdParams } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — staff opened the conversation: unread counter and its hand-off notification are cleared. */
export const POST = route({
  auth: { audience: "admin", permission: "social_ai.chat" },
  params: socialIdParams,
  handle: async (ctx) => {
    await ctx.resolve(MarkConversationReadToken).execute(ctx.params.id);
    return { read: true };
  },
});
