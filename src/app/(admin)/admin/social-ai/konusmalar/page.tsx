import { ConversationsManager } from "@/features/social-ai/ConversationsManager";
import { AiChatToken } from "@/modules/ai";
import { CONVERSATION_STATUS_KEYS, isChannel, type ConversationStatus } from "@/modules/social-ai";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Konuşmalar · Social AI Marketing" };
export const dynamic = "force-dynamic";

export default async function SocialConversationsPage({ searchParams }: { searchParams: Promise<{ konusma?: string; durum?: string; kanal?: string }> }) {
  await requireAdminPage("social_ai.chat");
  const [{ konusma, durum, kanal }, ai] = await Promise.all([searchParams, resolveService(AiChatToken).then((a) => a.status())]);
  return (
    <ConversationsManager
      initialId={konusma && /^[A-Za-z0-9_-]{1,80}$/.test(konusma) ? konusma : null}
      initialStatus={durum && (CONVERSATION_STATUS_KEYS as string[]).includes(durum) ? (durum as ConversationStatus) : null}
      initialChannel={kanal && isChannel(kanal) ? kanal : null}
      ai={ai}
    />
  );
}
