"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Braces, Clock3, FileCode2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { AdminBadge, AdminCard } from "@/components/admin/ui";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { MATCH_KEYS, type RowResult } from "@/modules/bulk/domain/bulk";
import type { FeedRecord } from "@/modules/bulk";
import { bulkApi } from "./api";
import { FeedWizard } from "./FeedWizard";
import { ProgressBar, ResultsTable } from "./ui";

const when = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const SCHEDULE: Record<number, string> = { 60: "Saatte bir", 180: "3 saatte bir", 360: "6 saatte bir", 720: "12 saatte bir", 1440: "Günde bir" };
const STATUS: Record<NonNullable<FeedRecord["lastStatus"]>, { label: string; tone: "green" | "amber" | "red" }> = {
  ok: { label: "Başarılı", tone: "green" }, partial: { label: "Kısmen", tone: "amber" }, failed: { label: "Başarısız", tone: "red" },
};

/** XML or REST / JSON feeds: list with last run, live sync with a progress bar, the setup wizard. */
export function FeedsPanel({ format, feeds, categories }: { format: "xml" | "json"; feeds: FeedRecord[]; categories: { id: string; label: string }[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<FeedRecord | "new" | null>(feeds.length ? null : "new");
  const [running, setRunning] = useState<{ id: string; cursor: number; total: number; created: number; updated: number; skipped: number; errors: number; results: RowResult[] } | null>(null);
  const [deleting, setDeleting] = useState<FeedRecord | null>(null);
  const [active, setActive] = useState(false);
  const stop = useRef(false);
  const mine = feeds.filter((f) => f.format === format);
  const Icon = format === "xml" ? FileCode2 : Braces;

  const run = async (f: FeedRecord) => {
    stop.current = false;
    setActive(true);
    let s = { id: f.id, cursor: 0, total: 0, created: 0, updated: 0, skipped: 0, errors: 0, results: [] as RowResult[] };
    setRunning(s);
    try {
      for (;;) {
        const r = (await bulkApi.runFeed(f.id)).data;
        s = { id: f.id, cursor: r.cursor, total: r.total, created: s.created + r.created, updated: s.updated + r.updated, skipped: s.skipped + r.skipped, errors: s.errors + r.errors, results: [...s.results, ...r.results].slice(-500) };
        setRunning(s);
        if (r.done || stop.current) break;
      }
      notify.success(stop.current ? "Senkron durduruldu; kaldığı yerden devam eder" : "Senkron tamamlandı", { description: `${s.created} yeni · ${s.updated} güncellendi · ${s.skipped} değişmedi${s.errors ? ` · ${s.errors} hatalı` : ""}` });
    } catch (e) {
      notify.error(e, { fallback: "Senkron yarıda kaldı." });
    } finally {
      setActive(false);
      router.refresh();
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await bulkApi.deleteFeed(deleting.id);
      notify.success("Kaynak silindi", { description: deleting.name });
      setDeleting(null);
      router.refresh();
    } catch (e) {
      notify.error(e);
    }
  };

  return (
    <div className="space-y-5">
      <AdminCard>
        <div className="flex flex-wrap items-center gap-4 p-5">
          <span className="grid size-12 flex-none place-items-center rounded-2xl bg-[#7367f0]/10 text-[#7367f0]"><Icon className="size-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">{format === "xml" ? "XML ile ürün yükle ve güncelle" : "REST / JSON bağlantısıyla ürün yükle ve güncelle"}</p>
            <p className="text-sm text-slate-500">
              {format === "xml"
                ? "Tedarikçinizin XML bağlantısını yapıştırın (Google Merchant, pazar yeri ve ERP çıktıları dahil her biçim). Ürün listesi ve alanlar otomatik bulunur, siz eşleştirmeyi onaylarsınız; sonra seçtiğiniz aralıkla canlı tutulur."
                : "Tedarikçinizin JSON veren API adresini yapıştırın; gerekirse API anahtarını şifreli saklarız. Alan haritası çıkarılır, anahtar (barkod, SKU …) ve fiyat / stok / görsel eşleştirilir."}
            </p>
          </div>
          {editing ? null : (
            <button type="button" onClick={() => setEditing("new")} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df]">
              <Plus className="size-4" />Yeni kaynak bağla
            </button>
          )}
        </div>
      </AdminCard>

      {editing ? (
        <FeedWizard key={editing === "new" ? "new" : editing.id} format={format} feed={editing === "new" ? null : editing} categories={categories}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} />
      ) : null}

      {mine.map((f) => {
        const live = running?.id === f.id ? running : null;
        return (
          <AdminCard key={f.id}>
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900">{f.name}</p>
                    {f.isActive ? <AdminBadge tone="green">Aktif</AdminBadge> : <AdminBadge tone="slate">Pasif</AdminBadge>}
                    {f.lastStatus ? <AdminBadge tone={STATUS[f.lastStatus].tone}>{STATUS[f.lastStatus].label}</AdminBadge> : <AdminBadge tone="slate">Henüz çalışmadı</AdminBadge>}
                    {f.passStartedAt ? <AdminBadge tone="blue">Devam ediyor</AdminBadge> : null}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-slate-500" title={f.url}>{f.url}</p>
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    <span>Anahtar: <strong>{MATCH_KEYS[f.matchKey].label}</strong> ← <code className="text-[11px]">{f.keyPath}</code></span>
                    <span>{Object.keys(f.mapping).length} alan eşleşti</span>
                    <span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" />{f.scheduleMinutes ? SCHEDULE[f.scheduleMinutes] : "Yalnız elle"}{f.nextRunAt && f.isActive ? ` · sonraki ${when.format(new Date(f.nextRunAt))}` : ""}</span>
                    {f.options.priceAdjustPct ? <span>Fiyat {f.options.priceAdjustPct > 0 ? "+" : ""}%{f.options.priceAdjustPct}</span> : null}
                    {f.options.createMissing ? <span>Yeni ürünleri oluşturur</span> : null}
                  </p>
                  {f.lastMessage ? <p className="mt-1 text-xs text-slate-500">Son çalışma{f.lastRunAt ? ` (${when.format(new Date(f.lastRunAt))})` : ""}: {f.lastMessage}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => run(f)} disabled={active}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><Play className="size-4" />Şimdi çalıştır</button>
                  <button type="button" onClick={() => setEditing(f)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Pencil className="size-4" />Düzenle</button>
                  <button type="button" onClick={() => setDeleting(f)} aria-label={`${f.name} sil`} className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
                </div>
              </div>
              {live ? (
                <div className="space-y-3">
                  <ProgressBar label={live.total ? `Senkron: ${live.created} yeni · ${live.updated} güncellendi · ${live.skipped} değişmedi${live.errors ? ` · ${live.errors} hatalı` : ""}` : "Kaynak indiriliyor…"}
                    done={live.cursor} total={live.total || 1} tone="green" onCancel={active ? () => { stop.current = true; } : undefined} />
                  {live.results.length ? <ResultsTable results={live.results} keyLabel={MATCH_KEYS[f.matchKey].label} /> : null}
                </div>
              ) : null}
            </div>
          </AdminCard>
        );
      })}
      {!mine.length && !editing ? <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">Henüz {format === "xml" ? "XML" : "REST / JSON"} kaynağı yok.</p> : null}

      <AdminConfirmDialog open={!!deleting} title="Kaynak silinsin mi?" description={deleting ? `“${deleting.name}” bağlantısı ve eşleştirmesi silinir. Ürünler mağazada kalır.` : undefined}
        confirmLabel="Evet, sil" onConfirm={remove} onCancel={() => setDeleting(null)} />
    </div>
  );
}
