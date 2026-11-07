"use client";

import { useState } from "react";
import { Braces, FileCode2, History, ImageUp, PackagePlus, PencilLine, Tag, Warehouse } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/ui";
import type { BulkJob, FeedRecord } from "@/modules/bulk";
import type { BulkOp } from "@/modules/bulk/domain/bulk";
import { ExcelImport } from "./ExcelImport";
import { FeedsPanel } from "./FeedsPanel";
import { JobsPanel } from "./JobsPanel";

export type BulkTab = "ekle" | "guncelle" | "gorseller" | "fiyat" | "stok" | "xml" | "rest" | "gecmis";

const GROUPS: { title: string; tabs: { key: BulkTab; label: string; icon: typeof Tag; op?: BulkOp }[] }[] = [
  { title: "Excel", tabs: [
    { key: "ekle", label: "Ürün ekle", icon: PackagePlus, op: "create" }, { key: "guncelle", label: "Ürün güncelle", icon: PencilLine, op: "update" },
    { key: "gorseller", label: "Görseller", icon: ImageUp, op: "images" }, { key: "fiyat", label: "Fiyat", icon: Tag, op: "prices" }, { key: "stok", label: "Stok", icon: Warehouse, op: "stock" },
  ] },
  { title: "Bağlantılı kaynaklar", tabs: [{ key: "xml", label: "XML", icon: FileCode2 }, { key: "rest", label: "REST / JSON", icon: Braces }] },
  { title: "", tabs: [{ key: "gecmis", label: "Geçmiş", icon: History }] },
];

/** Toplu işlemler: Excel tabs (template → automatic check → upload), XML and REST feeds, history (?sekme= keeps the tab). */
export function BulkOperations({ initialTab, feeds, jobs, categories }: { initialTab: BulkTab; feeds: FeedRecord[]; jobs: BulkJob[]; categories: { id: string; label: string }[] }) {
  const [tab, setTab] = useState<BulkTab>(initialTab);
  const select = (t: BulkTab) => {
    setTab(t);
    window.history.replaceState(null, "", `?sekme=${t}`);
  };
  const op = GROUPS.flatMap((g) => g.tabs).find((t) => t.key === tab)?.op;

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Toplu işlemler" subtitle="Excel ile yüzlerce ürünü tek seferde ekleyin ya da güncelleyin; tedarikçi XML / API bağlantılarıyla stok ve fiyatı canlı tutun. Her satır yazılmadan önce kontrol edilir." />
      <nav aria-label="Toplu işlem türleri" className="no-scrollbar flex items-end gap-5 overflow-x-auto border-b border-slate-200">
        {GROUPS.map((g, gi) => (
          <div key={gi} className="flex flex-none flex-col">
            {g.title ? <span className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.title}</span> : <span className="pb-1 text-[10px]">&nbsp;</span>}
            <div role="tablist" className="flex gap-1">
              {g.tabs.map((t) => {
                const on = tab === t.key;
                return (
                  <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => select(t.key)}
                    className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm ${on ? "font-semibold text-[#5b4fe0]" : "text-slate-500 hover:text-slate-800"}`}>
                    <t.icon className="size-4" />{t.label}
                    <span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#7367f0] transition-transform ${on ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      {op ? <ExcelImport key={op} op={op} /> : null}
      {tab === "xml" ? <FeedsPanel format="xml" feeds={feeds} categories={categories} /> : null}
      {tab === "rest" ? <FeedsPanel format="json" feeds={feeds} categories={categories} /> : null}
      {tab === "gecmis" ? <JobsPanel jobs={jobs} /> : null}
    </div>
  );
}
