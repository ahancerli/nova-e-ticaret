import { actorOf } from "@/modules/shared/actor";
import { SendStaffReplyToken, socialIdParams, staffReplySchema } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — a person answers; the conversation is taken over from the bot. 409 `social_ai_window_closed` outside the window. */
export const POST = route({
  auth: { audience: "admin", permission: "social_ai.chat" },
  params: socialIdParams,
  body: staffReplySchema,
  rateLimit: { name: "social-ai-reply", limit: 60, windowSec: 60 },
  handle: (ctx) => ctx.resolve(SendStaffReplyToken).execute(ctx.params.id, ctx.body.text, actorOf(ctx)),
});
