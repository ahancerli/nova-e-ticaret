import { NotFoundError } from "@/core";
import { GetConversationToken, socialIdParams } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — one conversation: messages, the tools the bot called, the reply window for staff. */
export const GET = route({
  auth: { audience: "admin", permission: "social_ai.chat" },
  params: socialIdParams,
  handle: async ({ params, resolve }) => {
    const detail = await resolve(GetConversationToken).execute(params.id);
    if (!detail) throw new NotFoundError("social_ai_conversation_not_found", "Konuşma bulunamadı.");
    return detail;
  },
});
