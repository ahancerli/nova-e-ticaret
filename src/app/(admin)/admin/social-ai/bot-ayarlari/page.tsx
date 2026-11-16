import { BotSettingsManager } from "@/features/social-ai/BotSettingsManager";
import { AiChatToken } from "@/modules/ai";
import { GetBotSettingsToken, ListReferralMapsToken } from "@/modules/social-ai";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Bot ayarları · Social AI Marketing" };
export const dynamic = "force-dynamic";

export default async function SocialBotSettingsPage() {
  await requireAdminPage("social_ai.manage");
  const referrals = await resolveService(ListReferralMapsToken);
  const [settings, maps, products, ai] = await Promise.all([
    resolveService(GetBotSettingsToken).then((q) => q.execute()), referrals.execute(), referrals.productOptions(), resolveService(AiChatToken).then((a) => a.status()),
  ]);
  return <BotSettingsManager key={settings.updatedAt} initial={settings} maps={maps} products={products.map((p) => ({ id: p.id, label: p.name }))} ai={ai} />;
}
