"use client";

import { useCallback, useState } from "react";
import { Settings2 } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/ui";
import type { SupportSettings } from "@/modules/support/domain/support";
import { SupportConsole } from "./SupportConsole";
import { SupportSettingsDrawer } from "./SupportSettingsDrawer";
import { useSupportInbox } from "./useSupportInbox";

/** /admin/canli-destek: full-height console, module switch banner, settings drawer (settings.write). */
export function SupportPage({ enabled: initialEnabled, canConfigure, initialId }: { enabled: boolean; canConfigure: boolean; initialId: string | null }) {
  const inbox = useSupportInbox();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const onSaved = useCallback((s: SupportSettings) => setEnabled(s.enabled), []);

  return (
    <div className="space-y-5">
      <AdminPageHeader title="Canlı destek" subtitle="Üyelerin mağazadan yazdığı mesajlar anında burada. Bu sayfa veya sağ alttaki pencere açıkken mağazada çevrimiçi görünürsünüz."
        actions={canConfigure && (
          <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50">
            <Settings2 className="size-4" /> Canlı destek ayarları
          </button>
        )} />
      {!enabled && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p>Canlı destek kapalı: mağazada Bize ulaşın butonu görünmüyor ve yeni konuşma başlamıyor. Mevcut konuşmaları yanıtlayabilirsiniz.</p>
          {canConfigure && <button type="button" onClick={() => setSettingsOpen(true)} className="h-9 rounded-xl bg-amber-900 px-3.5 font-semibold text-white hover:bg-amber-950">Canlı desteği aç</button>}
        </div>
      )}
      <SupportConsole inbox={inbox} initialId={initialId} />
      {canConfigure && <SupportSettingsDrawer open={settingsOpen} onClose={closeSettings} onSaved={onSaved} />}
    </div>
  );
}
