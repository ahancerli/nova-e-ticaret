import { PreviewBotToken, previewSchema } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — the panel's test chat: the real bot answers with the draft settings; nothing is stored or sent. */
export const POST = route({
  auth: { audience: "admin", permission: "social_ai.manage" },
  body: previewSchema,
  rateLimit: { name: "social-ai-preview", limit: 20, windowSec: 60 },
  handle: (ctx) => ctx.resolve(PreviewBotToken).execute({ channel: ctx.body.channel, settings: ctx.body.settings, messages: ctx.body.messages, referralMapId: ctx.body.referralMapId ?? null }),
});
