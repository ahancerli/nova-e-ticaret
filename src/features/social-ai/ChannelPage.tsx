"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { AdminPageHeader } from "@/components/admin/ui";
import type { ChannelOverview } from "@/modules/social-ai";
import { CHANNELS } from "@/modules/social-ai/domain/social-ai";
import { ChannelStatus } from "./ChannelStatus";
import { ChannelWizard } from "./ChannelWizard";
import { MetaAppCard } from "./MetaAppCard";
import { AiRequiredDialog, AiRequiredNote } from "./ui";

const SUBTITLE = {
  whatsapp: "WhatsApp numaranıza gelen mesajları yapay zekâ asistanınız cevaplar: ürün bulur, stok ve fiyat söyler, bağlantı gönderir, gerekince konuşmayı size devreder.",
  instagram: "Instagram DM'lerinizi yapay zekâ asistanınız cevaplar. Reklamdan ya da gönderiden gelen müşteriyle o ürün üzerinden konuşmaya başlar.",
} as const;

/** Social AI Marketing › WhatsApp / Instagram: the wizard until the channel is connected, the status screen after. */
export function ChannelPage({ overview, callback }: { overview: ChannelOverview; callback: { code: string | null; state: string | null; denied: boolean; error: string | null } }) {
  const router = useRouter();
  const { channel } = overview;
  const [justConnected, setJustConnected] = useState(false);
  const path = `/admin/social-ai/${channel}`;

  const refresh = useCallback(() => router.refresh(), [router]);
  const connected = useCallback(() => {
    setJustConnected(true);
    // Drops ?code=…&state=… from the address so a reload does not replay the callback.
    router.replace(path);
    router.refresh();
  }, [router, path]);

  return (
    <div className="space-y-6">
      <AdminPageHeader title={CHANNELS[channel].label} subtitle={SUBTITLE[channel]} />
      <AiRequiredNote ai={overview.ai} />
      {overview.connection
        ? <ChannelStatus key={overview.connection.updatedAt} overview={overview} justConnected={justConnected} onChanged={refresh} />
        : <ChannelWizard overview={overview} callback={callback} onConnected={connected} />}
      <MetaAppCard key={overview.app.updatedAt} channel={channel} app={overview.app} ready={overview.appReady} onSaved={refresh} />
      <AiRequiredDialog ai={overview.ai} />
    </div>
  );
}
