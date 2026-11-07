"use client";

import { useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/ui";
import { DevicePreview } from "./DevicePreview";
import type { SectionRow, SliderRow, StoryCollectionRow } from "@/modules/showcase/domain/showcase";
import { SectionsPanel, type ShowcaseOptions } from "./SectionsPanel";
import { SlidersPanel } from "./SlidersPanel";
import { StoriesPanel } from "./StoriesPanel";

const TABS = [
  { key: "duzen", label: "Ana sayfa düzeni" },
  { key: "slider", label: "Slider" },
  { key: "hikayeler", label: "Hikayeler" },
] as const;
export type ShowcaseTab = (typeof TABS)[number]["key"];

/** Vitrin: home page layout, sliders and stories in one place (?sekme= keeps the tab across refreshes). */
export function ShowcaseManager({ initialTab, sections, sliders, collections, options, now }: {
  initialTab: ShowcaseTab;
  sections: SectionRow[];
  sliders: SliderRow[];
  collections: StoryCollectionRow[];
  options: ShowcaseOptions;
  now: string;
}) {
  const [tab, setTab] = useState<ShowcaseTab>(initialTab);
  const [preview, setPreview] = useState(false);
  const select = (t: ShowcaseTab) => {
    setTab(t);
    window.history.replaceState(null, "", `?sekme=${t}`);
  };
  return (
    <div className="space-y-6">
      <AdminPageHeader title="Vitrin" subtitle="Ana sayfada ne, hangi sırayla ve ne zaman görünsün. Değişiklikler kaydedildiği anda mağazada geçerli olur."
        actions={
          <button type="button" onClick={() => setPreview(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df]">
            <MonitorSmartphone className="size-4" />Önizleme
          </button>
        } />
      <DevicePreview open={preview} onClose={() => setPreview(false)} />
      <div role="tablist" aria-label="Vitrin bölümleri" className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => select(t.key)}
            className={`relative px-4 py-3 text-sm ${tab === t.key ? "font-semibold text-[#5b4fe0]" : "text-slate-500 hover:text-slate-800"}`}>
            {t.label}
            <span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#7367f0] transition-transform ${tab === t.key ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
          </button>
        ))}
      </div>
      {tab === "duzen" ? <SectionsPanel sections={sections} sliders={sliders} collections={collections} options={options} now={now} /> : null}
      {tab === "slider" ? <SlidersPanel sliders={sliders} now={now} /> : null}
      {tab === "hikayeler" ? <StoriesPanel collections={collections} brands={options.brands} now={now} /> : null}
    </div>
  );
}
