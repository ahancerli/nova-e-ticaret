"use client";

import { useState } from "react";
import { AdminPageHeader } from "@/components/admin/ui";
import type { ConsentAdminView } from "@/modules/consent";
import { BannerSettingsCard } from "./BannerSettingsCard";
import { ConsentRecordsCard } from "./ConsentRecordsCard";
import { TrackingTagsCard } from "./TrackingTagsCard";

const TABS = { banner: "Onay banner'ı", tags: "İzleme etiketleri", records: "Onay kayıtları" } as const;
type Tab = keyof typeof TABS;

/**
 * Entegrasyonlar › Çerez onayı & izleme. The banner decides what may run; tags are the vendors that run after consent;
 * records are the proof. Every save returns the whole view (a new tag can renew consent → revision changes).
 */
export function ConsentManager({ initial }: { initial: ConsentAdminView }) {
  const [view, setView] = useState(initial);
  const [tab, setTab] = useState<Tab>("banner");

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Çerez onayı & izleme"
        subtitle="Ziyaretçiden KVKK'ya uygun çerez onayı alır; Google Analytics, Meta Pixel gibi etiketleri yalnız izin verilen kategoride çalıştırır."
      />
      <div role="tablist" aria-label="Bölümler" className="flex gap-1 border-b border-slate-200">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${tab === t ? "border-[#7367f0] text-[#7367f0]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {TABS[t]}
            {t === "tags" && view.tags.some((x) => x.isActive) && <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-[#7367f0]">{view.tags.filter((x) => x.isActive).length}</span>}
          </button>
        ))}
      </div>
      {tab === "banner" && <BannerSettingsCard view={view} onSaved={setView} />}
      {tab === "tags" && <TrackingTagsCard view={view} onSaved={setView} />}
      {tab === "records" && <ConsentRecordsCard />}
    </div>
  );
}
