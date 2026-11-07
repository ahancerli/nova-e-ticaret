"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Eye, KeyRound, Link2, Loader2, Plus, Save, Search, Sparkles, X } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import { Field, inputCls } from "@/components/admin/form";
import { BULK_FIELDS, MATCH_KEYS, MATCH_KEY_KEYS, type MatchKey, type RowResult } from "@/modules/bulk/domain/bulk";
import { DEFAULT_FEED_OPTIONS, FEED_FIELDS, type FeedField, type FeedMapping, type FeedOptions } from "@/modules/bulk/domain/feed";
import type { FeedAnalysis, FeedRecord } from "@/modules/bulk";
import { bulkApi, type FeedConfigInput } from "./api";
import { ResultsTable, StatTiles } from "./ui";

const SCHEDULES: [FeedConfigInput["scheduleMinutes"], string][] = [[null, "Yalnız elle"], [60, "Saatte bir"], [180, "3 saatte bir"], [360, "6 saatte bir"], [720, "12 saatte bir"], [1440, "Günde bir"]];
const FIELD_HELP: Partial<Record<FeedField, string>> = {
  price: "Satış fiyatı (indirimli fiyat varsa o).", compareAt: "Üstü çizili eski fiyat.", stock: "Adet; yoksa 0 sayılır.",
  images: "Birden çok alan seçebilirsiniz (ana + ek görseller).", category: "Kaynakta mağazanızın kategori adları varsa.",
};
const UPDATABLE: FeedField[] = ["price", "compareAt", "stock", "images", "name", "shortDescription", "description", "brand", "category", "taxRate"];

/**
 * Feed setup in four steps: source URL (+ optional API key header) → structure (product list found automatically) →
 * mapping (key + fields, suggested by name, each with a sample value) → rules, schedule and a dry-run preview.
 */
export function FeedWizard({ format, feed, categories, onClose, onSaved }: {
  format: "xml" | "json";
  feed: FeedRecord | null;
  categories: { id: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(feed?.url ?? "");
  const [headerName, setHeaderName] = useState(feed?.headerName ?? "");
  const [headerValue, setHeaderValue] = useState("");
  const [showHeader, setShowHeader] = useState(format === "json" || !!feed?.headerName);
  const [analysis, setAnalysis] = useState<FeedAnalysis | null>(null);
  // an existing feed is read again on open (fresh field list)
  const [analyzing, setAnalyzing] = useState(!!feed);
  const [itemPath, setItemPath] = useState(feed?.itemPath ?? "");
  const [matchKey, setMatchKey] = useState<MatchKey>(feed?.matchKey ?? "barcode");
  const [keyPath, setKeyPath] = useState(feed?.keyPath ?? "");
  const [mapping, setMapping] = useState<FeedMapping>(feed?.mapping ?? {});
  const [auto, setAuto] = useState<Set<FeedField>>(new Set());
  const [options, setOptions] = useState<FeedOptions>(feed?.options ?? DEFAULT_FEED_OPTIONS);
  const [schedule, setSchedule] = useState<FeedConfigInput["scheduleMinutes"]>((feed?.scheduleMinutes as FeedConfigInput["scheduleMinutes"]) ?? 360);
  const [name, setName] = useState(feed?.name ?? "");
  const [isActive, setIsActive] = useState(feed?.isActive ?? true);
  const [preview, setPreview] = useState<{ total: number; withoutKey: number; results: RowResult[] } | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  const errors = useFieldErrors();
  const fe = errors.get;
  const setOpt = (p: Partial<FeedOptions>) => setOptions((o) => ({ ...o, ...p }));

  const analyze = (path?: string | null) => {
    setAnalyzing(true);
    errors.clear();
    setPreview(null);
    return read(path);
  };

  /** Fetch + analyse; state is only set after the request (also used by the opening effect). */
  const read = async (path?: string | null) => {
    try {
      const r = await bulkApi.analyze({ url, headerName: headerName || null, headerValue: headerValue || null, feedId: feed?.id ?? null, itemPath: path ?? (analysis ? null : feed?.itemPath ?? null) });
      setAnalysis(r.data);
      setItemPath(r.data.itemPath);
      // a fresh source (or another product list) takes the suggestion; an edited feed keeps its saved mapping
      if (!feed || path) {
        const s = r.data.suggestion;
        if (s.matchKey && s.keyPath) { setMatchKey(s.matchKey); setKeyPath(s.keyPath); }
        setMapping(s.mapping);
        setAuto(new Set(Object.keys(s.mapping) as FeedField[]));
        if (!name) setName(new URL(url).hostname.replace(/^www\./, ""));
      }
    } catch (e) {
      errors.fromError(e);
      notify.error(e, { fallback: "Kaynak okunamadı." });
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (feed) void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open an existing feed once
  }, []);

  const samples = useMemo(() => new Map((analysis?.fields ?? []).map((f) => [f.path, f])), [analysis]);
  const sampleOf = (path?: string) => path?.split("|").map((p) => samples.get(p.trim())?.samples[0]).filter(Boolean).join(" · ") ?? "";

  const config = (): FeedConfigInput => ({
    name: name.trim(), format: analysis?.format ?? format, url: url.trim(), itemPath, matchKey, keyPath,
    mapping: Object.fromEntries(Object.entries(mapping).filter(([, p]) => p)) as FeedMapping,
    options: { ...options, updateFields: options.updateFields.filter((f) => mapping[f]) },
    scheduleMinutes: schedule, isActive, headerName: showHeader && headerName ? headerName : null, headerValue: showHeader && headerValue ? headerValue : null,
  });

  const runPreview = async () => {
    setBusy("preview");
    errors.clear();
    try {
      setPreview((await bulkApi.preview({ ...config(), feedId: feed?.id ?? null })).data);
    } catch (e) {
      errors.fromError(e);
      notify.error(e);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    errors.clear();
    try {
      if (feed) await bulkApi.updateFeed(feed.id, { ...config(), expectedUpdatedAt: feed.updatedAt, removeHeader: !showHeader || !headerName });
      else await bulkApi.createFeed(config());
      notify.success(feed ? "Kaynak güncellendi" : "Kaynak kaydedildi", { description: "“Şimdi çalıştır” ile ilk senkronu başlatabilirsiniz." });
      onSaved();
    } catch (e) {
      const n = errors.fromError(e);
      notify.error(e, { description: n ? "İşaretli alanları kontrol edin." : undefined });
      setBusy(null);
    }
  };

  const fieldOptions = analysis?.fields ?? [];
  const pathSelect = (id: string, value: string | undefined, onChange: (v: string) => void, placeholder = "— eşleştirme yok —") => (
    <select id={id} className={`${inputCls} font-mono text-xs`} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {fieldOptions.map((f) => <option key={f.path} value={f.path}>{f.path}{f.samples[0] ? `  —  ${f.samples[0].slice(0, 40)}` : ""}</option>)}
    </select>
  );
  const imagePaths = (mapping.images ?? "").split("|").map((p) => p.trim()).filter(Boolean);
  const okCount = preview?.results.filter((r) => r.status === "ok").length ?? 0;

  return (
    <AdminCard className="overflow-hidden ring-2 ring-[#7367f0]/20">
      <AdminCardTitle title={feed ? `“${feed.name}” kaynağını düzenle` : format === "xml" ? "Yeni XML kaynağı" : "Yeni REST / JSON kaynağı"}
        subtitle="Kaynak hangi biçimde olursa olsun ürün listesi ve alanlar otomatik bulunur; eşleştirmeyi siz onaylarsınız."
        actions={<button type="button" onClick={onClose} aria-label="Kapat" className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="size-4" /></button>} />

      <div className="space-y-6 p-5">
        {/* 1 — source */}
        <section className="space-y-3">
          <Step n={1} title="Kaynak adresi" done={!!analysis} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="fd-url" className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 focus-within:border-[#7367f0] focus-within:ring-2 focus-within:ring-[#7367f0]/20">
              <Link2 className="size-4 flex-none text-slate-400" />
              <input id="fd-url" className="h-11 w-full bg-transparent font-mono text-sm outline-none" placeholder={format === "xml" ? "https://tedarikci.com/urunler.xml" : "https://api.tedarikci.com/v1/products"}
                value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void analyze(); } }} aria-invalid={!!fe("url")} />
            </label>
            <button type="button" onClick={() => analyze()} disabled={analyzing || !/^https:\/\/.+/i.test(url.trim())}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-50">
              {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}{analyzing ? "Okunuyor…" : analysis ? "Yeniden oku" : "Analiz et"}
            </button>
          </div>
          {fe("url") ? <p className="text-xs text-red-600">{fe("url")}</p> : <p className="text-xs text-slate-500">Yalnız https adresleri; sunucumuz en fazla 15 MB indirir. İç ağ / yerel adresler güvenlik nedeniyle engellenir.</p>}
          <button type="button" onClick={() => setShowHeader((v) => !v)} className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5b4fe0] hover:underline">
            <KeyRound className="size-3.5" />{showHeader ? "Kimlik başlığını gizle" : "Kaynak API anahtarı istiyor"}
          </button>
          {showHeader ? (
            <div className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
              <Field id="fd-hn" label="Başlık adı" error={fe("headerName")} hint="Örn. Authorization veya X-Api-Key"><input id="fd-hn" className={`${inputCls} font-mono`} value={headerName} onChange={(e) => setHeaderName(e.target.value)} placeholder="X-Api-Key" /></Field>
              <Field id="fd-hv" label="Değer" hint={feed?.hasHeaderSecret ? "Kayıtlı (gösterilmez). Değiştirmek için yeni değeri yazın." : "Şifrelenerek saklanır, bir daha gösterilmez."}>
                <input id="fd-hv" type="password" autoComplete="off" className={`${inputCls} font-mono`} value={headerValue} onChange={(e) => setHeaderValue(e.target.value)} placeholder={feed?.hasHeaderSecret ? "••••••••" : "Bearer …"} />
              </Field>
            </div>
          ) : null}
        </section>

        {analysis ? (
          <>
            {/* 2 — structure */}
            <section className="space-y-3">
              <Step n={2} title="Ürün listesi" done />
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <AdminBadge tone="purple">{analysis.format.toUpperCase()}</AdminBadge>
                <span><strong className="text-slate-900">{analysis.itemCount.toLocaleString("tr-TR")}</strong> ürün bulundu · {analysis.fields.length} alan</span>
                {analysis.format !== format ? <AdminBadge tone="amber">Bu kaynak {analysis.format.toUpperCase()}; {analysis.format === "xml" ? "XML" : "REST / JSON"} sekmesinde listelenecek</AdminBadge> : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <Field id="fd-list" label="Ürünlerin bulunduğu liste" hint="Otomatik seçildi; kaynakta birden çok liste varsa değiştirebilirsiniz.">
                  <select id="fd-list" className={`${inputCls} font-mono text-xs`} value={itemPath} onChange={(e) => { setItemPath(e.target.value); void analyze(e.target.value); }}>
                    {analysis.lists.map((l) => <option key={l.path} value={l.path}>{l.path} — {l.count.toLocaleString("tr-TR")} kayıt</option>)}
                  </select>
                </Field>
              </div>
              <details className="rounded-xl border border-slate-200 bg-slate-50/60">
                <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium text-slate-600">Ham veriyi göster (ilk 2 kayıt)</summary>
                <pre className="max-h-72 overflow-auto border-t border-slate-200 bg-slate-900 p-4 text-[11px] leading-5 text-slate-100">{analysis.sample}</pre>
              </details>
            </section>

            {/* 3 — mapping */}
            <section className="space-y-3">
              <Step n={3} title="Eşleştirme" done={!!keyPath} />
              <div className="rounded-2xl border border-[#7367f0]/30 bg-[#7367f0]/5 p-4">
                <p className="mb-2 text-sm font-semibold text-slate-800">Anahtar: ürünleri neyle tanıyalım?</p>
                <div className="grid gap-3 md:grid-cols-[220px_auto_minmax(0,1fr)] md:items-end">
                  <Field id="fd-mk" label="Mağazadaki değer" error={fe("matchKey")}>
                    <select id="fd-mk" className={inputCls} value={matchKey} onChange={(e) => setMatchKey(e.target.value as MatchKey)}>
                      {MATCH_KEY_KEYS.map((k) => <option key={k} value={k}>{MATCH_KEYS[k].label}</option>)}
                    </select>
                  </Field>
                  <ArrowRight className="mx-auto mb-3 hidden size-4 rotate-180 text-slate-400 md:block" aria-hidden />
                  <Field id="fd-kp" label="Kaynaktaki alan" error={fe("keyPath")} hint={keyPath ? `Örnek: ${sampleOf(keyPath) || "—"}` : undefined}>
                    {pathSelect("fd-kp", keyPath, setKeyPath, "— alan seçin —")}
                  </Field>
                </div>
              </div>
              {fe("mapping") ? <p className="text-xs text-red-600">{fe("mapping")}</p> : null}
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="w-48 px-4 py-2.5 font-medium">Mağaza alanı</th><th className="px-3 py-2.5 font-medium">Kaynaktaki alan</th><th className="hidden w-64 px-4 py-2.5 font-medium lg:table-cell">Örnek değer</th></tr></thead>
                  <tbody>
                    {FEED_FIELDS.filter((f) => f !== "images").map((f) => (
                      <tr key={f} className="border-t border-slate-100">
                        <td className="px-4 py-2">
                          <span className="flex items-center gap-1.5 font-medium text-slate-800">{BULK_FIELDS[f].label}{auto.has(f) && mapping[f] ? <Sparkles className="size-3.5 text-[#7367f0]" aria-label="otomatik eşleşti" /> : null}</span>
                          {FIELD_HELP[f] ? <span className="text-[11px] text-slate-500">{FIELD_HELP[f]}</span> : null}
                        </td>
                        <td className="px-3 py-2">{pathSelect(`fd-m-${f}`, mapping[f], (v) => { setMapping((m) => ({ ...m, [f]: v || undefined })); setAuto((a) => { const n = new Set(a); n.delete(f); return n; }); })}</td>
                        <td className="hidden max-w-64 truncate px-4 py-2 text-xs text-slate-500 lg:table-cell" title={sampleOf(mapping[f])}>{sampleOf(mapping[f]) || "—"}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-slate-100 align-top">
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-1.5 font-medium text-slate-800">Görseller{auto.has("images") && mapping.images ? <Sparkles className="size-3.5 text-[#7367f0]" /> : null}</span>
                        <span className="text-[11px] text-slate-500">{FIELD_HELP.images}</span>
                      </td>
                      <td className="space-y-1.5 px-3 py-2">
                        {[...imagePaths, ""].slice(0, 4).map((p, i) => (
                          <div key={i}>{pathSelect(`fd-img-${i}`, p, (v) => {
                            const next = [...imagePaths]; if (v) next[i] = v; else next.splice(i, 1);
                            setMapping((m) => ({ ...m, images: next.filter(Boolean).join(" | ") || undefined }));
                          }, i ? "+ ek görsel alanı" : "— eşleştirme yok —")}</div>
                        ))}
                      </td>
                      <td className="hidden max-w-64 truncate px-4 py-2 text-xs text-slate-500 lg:table-cell">{imagePaths.length ? `${imagePaths.length} alan` : "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* 4 — rules */}
            <section className="space-y-4">
              <Step n={4} title="Kurallar ve zamanlama" done={false} />
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2 rounded-xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-800">Mağazada olan ürünlerde güncellenecekler</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {UPDATABLE.filter((f) => mapping[f]).map((f) => (
                      <label key={f} className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" className="size-4 accent-[#7367f0]" checked={options.updateFields.includes(f)}
                          onChange={(e) => setOpt({ updateFields: e.target.checked ? [...options.updateFields, f] : options.updateFields.filter((x) => x !== f) })} />
                        {f === "images" ? "Görseller" : BULK_FIELDS[f].label}
                      </label>
                    ))}
                  </div>
                  {!UPDATABLE.some((f) => mapping[f]) ? <p className="text-xs text-slate-500">Önce alanları eşleştirin.</p> : null}
                  <p className="text-xs text-slate-500">Seçilmeyen alanlara dokunulmaz (ör. kendi yazdığınız açıklamalar korunur).</p>
                </div>
                <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                  <Field id="fd-adj" label="Fiyat ayarı (%)" error={fe("priceAdjustPct")} hint="Kaynak fiyatına uygulanır: 20 = %20 kâr marjı, −5 = %5 indirim.">
                    <input id="fd-adj" type="number" min={-90} max={500} step="0.5" className={inputCls} value={options.priceAdjustPct} onChange={(e) => setOpt({ priceAdjustPct: Number(e.target.value) || 0 })} />
                  </Field>
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input type="checkbox" className="mt-0.5 size-4 accent-[#7367f0]" checked={options.zeroMissing} onChange={(e) => setOpt({ zeroMissing: e.target.checked })} />
                    <span>Kaynaktan kalkan ürünlerin stoğunu 0 yap<span className="block text-xs text-slate-500">Tedarikçi ürünü listeden çıkardıysa satışa kapanır.</span></span>
                  </label>
                </div>
                <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input type="checkbox" className="mt-0.5 size-4 accent-[#7367f0]" checked={options.createMissing} onChange={(e) => setOpt({ createMissing: e.target.checked })} />
                    <span>Mağazada olmayan ürünleri oluştur<span className="block text-xs text-slate-500">Ürün adı ve fiyat eşleştirilmiş olmalı.</span></span>
                  </label>
                  {options.createMissing ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field id="fd-cat" label="Kategori" error={fe("defaultCategoryId")}>
                        <select id="fd-cat" className={inputCls} value={options.defaultCategoryId ?? ""} onChange={(e) => setOpt({ defaultCategoryId: e.target.value || null })}>
                          <option value="">Seçin</option>
                          {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </Field>
                      <Field id="fd-st" label="Durum" error={fe("newStatus")}>
                        <select id="fd-st" className={inputCls} value={options.newStatus} onChange={(e) => setOpt({ newStatus: e.target.value as FeedOptions["newStatus"] })}>
                          <option value="draft">Taslak (kontrol edip yayınlarım)</option>
                          <option value="published">Hemen yayında</option>
                        </select>
                      </Field>
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
                  <Field id="fd-name" label="Kaynak adı" error={fe("name")}><input id="fd-name" className={inputCls} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></Field>
                  <Field id="fd-sch" label="Otomatik güncelleme" hint="Canlı stok ve fiyat için">
                    <select id="fd-sch" className={inputCls} value={schedule ?? ""} onChange={(e) => setSchedule(e.target.value ? (Number(e.target.value) as FeedConfigInput["scheduleMinutes"]) : null)}>
                      {SCHEDULES.map(([v, l]) => <option key={l} value={v ?? ""}>{l}</option>)}
                    </select>
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                    <input type="checkbox" className="size-4 accent-[#7367f0]" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />Aktif (kapalıyken otomatik çalışmaz)
                  </label>
                </div>
              </div>
            </section>

            {preview ? (
              <section className="space-y-3">
                <p className="text-sm font-semibold text-slate-800">Önizleme — ilk {preview.results.length} kayıt (hiçbir şey yazılmadı)</p>
                <StatTiles items={[{ label: "Kaynaktaki kayıt", value: preview.total }, { label: "Değişecek / eklenecek", value: okCount, tone: "green" }, { label: "Değişiklik yok / atlanır", value: preview.results.filter((r) => r.status === "unchanged").length }, { label: "Hatalı", value: preview.results.filter((r) => r.status === "error").length, tone: "red" }]} />
                {preview.withoutKey ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{preview.withoutKey} kayıtta anahtar alanı boş; bu kayıtlar atlanır.</p> : null}
                <ResultsTable results={preview.results} keyLabel={MATCH_KEYS[matchKey].label} />
              </section>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Vazgeç</button>
              <button type="button" onClick={runPreview} disabled={!!busy || !keyPath}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#7367f0]/40 px-4 text-sm font-semibold text-[#5b4fe0] hover:bg-[#7367f0]/5 disabled:opacity-50">
                {busy === "preview" ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}Önizle
              </button>
              <button type="button" onClick={save} disabled={!!busy || !keyPath || name.trim().length < 2}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-50">
                {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : feed ? <Save className="size-4" /> : <Plus className="size-4" />}{feed ? "Kaydet" : "Kaynağı kaydet"}
              </button>
            </div>
          </>
        ) : analyzing ? (
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-600"><Loader2 className="size-5 animate-spin text-[#7367f0]" />Kaynak indiriliyor ve yapısı çıkarılıyor…</div>
        ) : null}
      </div>
    </AdminCard>
  );
}

function Step({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
      <span className={`grid size-6 place-items-center rounded-full text-xs font-bold ${done ? "bg-emerald-500 text-white" : "bg-[#7367f0] text-white"}`}>{n}</span>{title}
    </h3>
  );
}
