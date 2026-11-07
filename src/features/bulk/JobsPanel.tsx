"use client";

import { Fragment, useState } from "react";
import { ChevronRight, History } from "lucide-react";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import { MATCH_KEYS } from "@/modules/bulk/domain/bulk";
import type { BulkJob } from "@/modules/bulk";

const when = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const KIND: Record<BulkJob["kind"], string> = {
  excel_create: "Excel · ürün ekleme", excel_update: "Excel · ürün güncelleme", excel_images: "Excel · görsel", excel_prices: "Excel · fiyat", excel_stock: "Excel · stok", feed: "XML / REST senkronu",
};
const STATUS: Record<BulkJob["status"], { label: string; tone: "blue" | "green" | "red" }> = { running: { label: "Sürüyor", tone: "blue" }, completed: { label: "Tamamlandı", tone: "green" }, failed: { label: "Başarısız", tone: "red" } };

/** History of imports and feed runs; a row opens its first errors. */
export function JobsPanel({ jobs }: { jobs: BulkJob[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <AdminCard className="overflow-hidden">
      <AdminCardTitle title="İşlem geçmişi" subtitle="Son 100 toplu işlem. Her ürün değişikliği ayrıca denetim kayıtlarında." />
      {!jobs.length ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center text-sm text-slate-500"><History className="size-8 text-slate-300" />Henüz toplu işlem yapılmadı.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-5 py-2.5 font-medium">Tarih</th><th className="px-3 py-2.5 font-medium">İşlem</th><th className="px-3 py-2.5 font-medium">Kaynak</th><th className="px-3 py-2.5 text-right font-medium">Yeni</th><th className="px-3 py-2.5 text-right font-medium">Güncellendi</th><th className="px-3 py-2.5 text-right font-medium">Değişmedi</th><th className="px-3 py-2.5 text-right font-medium">Hatalı</th><th className="px-5 py-2.5 font-medium">Durum</th></tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <Fragment key={j.id}>
                  <tr className={`border-t border-slate-100 ${j.errors.length ? "cursor-pointer hover:bg-slate-50" : ""}`} onClick={() => j.errors.length && setOpen(open === j.id ? null : j.id)}>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">
                      <span className="flex items-center gap-1.5">{j.errors.length ? <ChevronRight className={`size-4 text-slate-400 transition-transform ${open === j.id ? "rotate-90" : ""}`} /> : <span className="w-4" />}{when.format(new Date(j.createdAt))}</span>
                    </td>
                    <td className="px-3 py-3"><span className="font-medium text-slate-800">{KIND[j.kind]}</span>{j.matchKey ? <span className="block text-xs text-slate-500">Anahtar: {MATCH_KEYS[j.matchKey].label}</span> : null}</td>
                    <td className="max-w-56 truncate px-3 py-3 text-slate-600" title={j.source}>{j.source}<span className="block text-xs text-slate-400">{j.createdByName ?? ""}</span></td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-600">{j.createdRows}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-600">{j.updatedRows}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-500">{j.skippedRows}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-red-600">{j.errorRows}</td>
                    <td className="px-5 py-3"><AdminBadge tone={STATUS[j.status].tone}>{STATUS[j.status].label}</AdminBadge></td>
                  </tr>
                  {open === j.id ? (
                    <tr className="bg-red-50/40"><td colSpan={8} className="px-5 py-3">
                      <ul className="space-y-1 text-xs text-slate-700">
                        {j.errors.map((e, i) => <li key={i}><strong className="tabular-nums">Satır {e.line}</strong>{e.key ? <code className="mx-1 text-[11px]">{e.key}</code> : " "}— {e.message}</li>)}
                      </ul>
                      {j.errorRows > j.errors.length ? <p className="mt-1 text-xs text-slate-500">İlk {j.errors.length} hata gösteriliyor.</p> : null}
                    </td></tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminCard>
  );
}
