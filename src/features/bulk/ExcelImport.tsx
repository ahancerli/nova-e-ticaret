"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileWarning, Loader2, RotateCcw, Upload, X } from "lucide-react";
import { notify } from "@/lib/toast";
import { errorMessage } from "@/lib/api-client";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { BULK_OPS, MATCH_KEYS, MATCH_KEY_KEYS, MAX_ROWS, groupKeyOf, type BulkOp, type MatchKey, type RowResult, type VariantAxisColumn } from "@/modules/bulk/domain/bulk";
import { bulkApi } from "./api";
import { chunkRows, downloadReport, downloadTemplate, parseSheet, type ParsedSheet } from "./sheet";
import { ProgressBar, ResultsTable, StatTiles } from "./ui";

type Phase = "idle" | "reading" | "checking" | "checked" | "applying" | "done";

/**
 * One Excel tab (ürün ekle / güncelle / görsel / fiyat / stok). Two-step safety: the file is checked automatically
 * as soon as it is chosen (browser rules first, then the server's dry run — nothing is written), and only rows that
 * passed are sent when the shop presses "Yükle". "Ürün ekle" reads variant columns (`axes`: Renk, Beden …).
 */
export function ExcelImport({ op, axes = [] }: { op: BulkOp; axes?: VariantAxisColumn[] }) {
  const spec = BULK_OPS[op];
  const [key, setKey] = useState<MatchKey>("barcode");
  // variant columns of the downloadable template ("Ürün ekle")
  const [templateAxes, setTemplateAxes] = useState<string[]>([]);
  const [imageMode, setImageMode] = useState<"replace" | "append">("replace");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [results, setResults] = useState<Map<number, RowResult>>(new Map());
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [fatal, setFatal] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastFile = useRef<File | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const rows = useMemo(() => (sheet ? sheet.local.map((r) => results.get(r.line) ?? { line: r.line, key: r.key, status: r.errors.length ? "error" : "ok", productId: null, productName: null, messages: r.errors } as RowResult) : []), [sheet, results]);
  const ready = rows.filter((r) => r.status === "ok");
  const busy = phase === "reading" || phase === "checking" || phase === "applying";

  const reset = () => {
    abort.current?.abort();
    setSheet(null); setResults(new Map()); setPhase("idle"); setFatal(null); setJobId(null); setProgress({ done: 0, total: 0 });
  };

  /** Read + check a file (also re-run when the key or image mode changes). */
  const load = async (file: File, k = key, mode = imageMode) => {
    reset();
    lastFile.current = file;
    setPhase("reading");
    let parsed: ParsedSheet;
    try {
      parsed = await parseSheet(file, op, k, axes);
    } catch (e) {
      setFatal(e instanceof Error ? e.message : "Dosya okunamadı.");
      setPhase("idle");
      return;
    }
    setSheet(parsed);
    if (parsed.missingColumns.length || !parsed.rows.length) { setPhase("checked"); return; }

    // server dry run for the rows that passed the browser check, in chunks. A model (rows sharing a model code) is
    // written all-or-nothing: one bad row holds back its siblings, so they never create a product with missing variants.
    const badModels = new Map<string, number[]>();
    if (op === "create") for (const r of parsed.local) if (r.errors.length) badModels.set(groupKeyOf(r), [...(badModels.get(groupKeyOf(r)) ?? []), r.line]);
    const next = new Map<number, RowResult>();
    for (const r of parsed.local) {
      const bad = !r.errors.length ? badModels.get(groupKeyOf(r)) : undefined;
      if (bad) next.set(r.line, { line: r.line, key: r.values.sku ?? r.key, status: "error", productId: null, productName: null, messages: [`Aynı modeldeki ${bad.join(", ")}. satır hatalı; bir modelin satırları birlikte yüklenir.`] });
    }
    setResults(new Map(next));
    const valid = parsed.rows.filter((_, i) => !parsed.local[i]!.errors.length && !next.has(parsed.local[i]!.line));
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase("checking");
    setProgress({ done: 0, total: valid.length });
    try {
      let done = 0;
      for (const part of chunkRows(op, valid, spec.chunk)) {
        const r = await bulkApi.check({ op, matchKey: k, imageMode: mode, rows: part }, ctrl.signal);
        for (const x of r.data) next.set(x.line, x);
        setResults(new Map(next));
        done += part.length;
        setProgress({ done, total: valid.length });
      }
      setPhase("checked");
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setFatal(`Doğrulama yarıda kaldı: ${errorMessage(e)}`);
      setPhase("checked");
    }
  };

  const apply = async () => {
    if (!sheet) return;
    setConfirm(false);
    const send = sheet.rows.filter((r) => results.get(r.line)?.status === "ok");
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase("applying");
    setProgress({ done: 0, total: send.length });
    let job: string | null = null;
    const next = new Map(results);
    // rows refused by the check are not sent, but the job history should count them
    const refused = rows.filter((r) => r.status === "error");
    const statusOf = (line: number, localErrors: number) => next.get(line)?.status ?? (localErrors ? "error" : "ok");
    const chunks = chunkRows(op, send, spec.chunk);
    let done = 0;
    try {
      for (const [ci, part] of chunks.entries()) {
        if (ctrl.signal.aborted) break;
        const r = await bulkApi.apply({
          op, matchKey: key, imageMode, rows: part, jobId: job, source: sheet.fileName, totalRows: sheet.rows.length, final: ci === chunks.length - 1,
          ...(job ? {} : { rejectedCount: refused.length, rejected: refused.slice(0, 100).map((x) => ({ line: x.line, key: x.key, message: x.messages.join(" ").slice(0, 500) })) }),
        });
        job = r.data.jobId;
        setJobId(job);
        for (const x of r.data.results) next.set(x.line, x);
        setResults(new Map(next));
        done += part.length;
        setProgress({ done, total: send.length });
      }
      if (ctrl.signal.aborted && job) await bulkApi.apply({ op, matchKey: key, imageMode, rows: [], jobId: job, source: sheet.fileName, totalRows: sheet.rows.length, final: true });
      const all = sheet.local.map((r) => statusOf(r.line, r.errors.length));
      const created = all.filter((x) => x === "created").length, updated = all.filter((x) => x === "updated").length;
      const failed = all.filter((x) => x === "error").length;
      notify.success(ctrl.signal.aborted ? "Yükleme durduruldu" : "Yükleme tamamlandı", { description: `${created ? `${created} satır eklendi · ` : ""}${updated} güncellendi${failed ? ` · ${failed} hatalı` : ""}` });
    } catch (e) {
      notify.error(e, { fallback: "Yükleme yarıda kaldı." });
      if (job) await bulkApi.apply({ op, matchKey: key, imageMode, rows: [], jobId: job, source: sheet.fileName, totalRows: sheet.rows.length, final: true }).catch(() => undefined);
    } finally {
      setPhase("done");
    }
  };

  const pick = () => fileRef.current?.click();
  const stats = {
    total: rows.length,
    ready: ready.length,
    unchanged: rows.filter((r) => r.status === "unchanged").length,
    errors: rows.filter((r) => r.status === "error").length,
    written: rows.filter((r) => r.status === "created" || r.status === "updated").length,
  };
  const verb = op === "create" ? "eklenecek" : "güncellenecek";

  return (
    <div className="space-y-5">
      <AdminCard>
        <AdminCardTitle title={spec.title} subtitle={spec.help} />
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            {spec.needsKey ? (
              <fieldset>
                <legend className="mb-1.5 text-xs font-medium text-slate-600">Ürünleri hangi değerle bulalım? <span className="font-normal text-slate-500">(dosyanın ilk sütunu)</span></legend>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {MATCH_KEY_KEYS.map((k) => (
                    <label key={k} className={`flex cursor-pointer flex-col rounded-xl border px-3 py-2.5 transition ${key === k ? "border-[#7367f0] bg-[#7367f0]/5 ring-1 ring-[#7367f0]/30" : "border-slate-200 hover:bg-slate-50"} ${busy ? "pointer-events-none opacity-60" : ""}`}>
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        <input type="radio" name={`key-${op}`} checked={key === k} disabled={busy} className="accent-[#7367f0]"
                          onChange={() => { setKey(k); if (lastFile.current) void load(lastFile.current, k); }} />{MATCH_KEYS[k].label}
                      </span>
                      <span className="mt-0.5 pl-5 text-xs text-slate-500">{MATCH_KEYS[k].hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {op === "images" ? (
              <div role="radiogroup" aria-label="Görseller" className="inline-flex rounded-lg bg-slate-100 p-0.5">
                {([["replace", "Galerinin yerine geçsin"], ["append", "Galeriye eklensin"]] as const).map(([m, l]) => (
                  <button key={m} type="button" role="radio" aria-checked={imageMode === m} disabled={busy}
                    onClick={() => { setImageMode(m); if (lastFile.current) void load(lastFile.current, key, m); }}
                    className={`h-8 rounded-md px-3 text-sm font-medium ${imageMode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{l}</button>
                ))}
              </div>
            ) : null}

            <input ref={fileRef} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void load(f); }} />
            {!sheet ? (
              <button type="button" onClick={pick} disabled={busy}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void load(f); }}
                className={`group flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition ${dragging ? "scale-[1.01] border-[#7367f0] bg-indigo-50/70" : "border-slate-300 bg-slate-50/60 hover:border-[#7367f0]/60 hover:bg-indigo-50/40"}`}>
                <span className={`grid size-12 place-items-center rounded-2xl bg-white text-[#7367f0] shadow-sm ring-1 ring-slate-200 transition ${dragging ? "-translate-y-1" : "group-hover:-translate-y-0.5"}`}>
                  {phase === "reading" ? <Loader2 className="size-6 animate-spin" /> : <FileSpreadsheet className="size-6" />}
                </span>
                <span className="text-sm text-slate-700">{phase === "reading" ? "Dosya okunuyor…" : dragging ? "Bırakın, kontrol edelim" : <>Excel dosyasını sürükleyin veya <span className="font-semibold text-[#7367f0]">bilgisayardan seçin</span></>}</span>
                <span className="text-xs text-slate-500">.xlsx veya .csv · en fazla 10 MB · {MAX_ROWS.toLocaleString("tr-TR")} satır · dosya tarayıcınızda okunur, sunucuya yalnız hücre değerleri gider</span>
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><FileSpreadsheet className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">{sheet.fileName}</span>
                  <span className="text-xs text-slate-500">{sheet.rows.length.toLocaleString("tr-TR")} satır okundu</span>
                </span>
                <button type="button" onClick={pick} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RotateCcw className="size-3.5" />Başka dosya</button>
                <button type="button" onClick={reset} disabled={phase === "applying"} aria-label="Dosyayı kaldır" className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"><X className="size-4" /></button>
              </div>
            )}
            {fatal ? <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 size-4 flex-none" />{fatal}</p> : null}
            {sheet?.missingColumns.length ? (
              <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><FileWarning className="mt-0.5 size-4 flex-none" />
                <span>Zorunlu sütun bulunamadı: <strong>{sheet.missingColumns.join(", ")}</strong>. Örnek dosyadaki başlıkları kullanın{spec.needsKey ? " ve doğru anahtarı seçin" : ""}.</span></p>
            ) : null}
            {sheet?.unknownHeaders.length ? (
              <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800">Tanınmayan sütunlar yok sayıldı: {sheet.unknownHeaders.slice(0, 8).join(", ")}{sheet.unknownHeaders.length > 8 ? " …" : ""}</p>
            ) : null}
          </div>

          <aside className="space-y-3 rounded-2xl bg-gradient-to-br from-[#7367f0]/10 to-transparent p-4">
            <p className="text-sm font-semibold text-slate-800">1. Örnek dosyayı indirin</p>
            <p className="text-xs text-slate-600">Başlıklar ve iki örnek satır hazır; ikinci sayfada her sütun açıklanıyor.{spec.needsKey ? ` İlk sütun: ${MATCH_KEYS[key].label}.` : ""}</p>
            {op === "create" && axes.length ? (
              <fieldset>
                <legend className="mb-1 text-xs font-medium text-slate-700">Varyantlı ürünler için sütunlar</legend>
                <div className="flex flex-wrap gap-1.5">
                  {axes.map((a) => {
                    const on = templateAxes.includes(a.code);
                    return (
                      <button key={a.code} type="button" aria-pressed={on} onClick={() => setTemplateAxes((t) => (on ? t.filter((x) => x !== a.code) : [...t, a.code]))}
                        className={`h-7 rounded-md border px-2 text-xs font-medium ${on ? "border-[#7367f0] bg-[#7367f0] text-white" : "border-slate-200 bg-white text-slate-600"}`}>{a.label}</button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Seçtikleriniz örnek dosyaya “Varyant: Renk” gibi sütun olarak eklenir; aynı model kodlu satırlar tek ürünün varyantları olur.</p>
              </fieldset>
            ) : null}
            <button type="button" onClick={() => downloadTemplate(op, key, axes.filter((a) => templateAxes.includes(a.code)))} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-[#5b4fe0] shadow-sm ring-1 ring-[#7367f0]/30 hover:bg-[#7367f0]/5">
              <Download className="size-4" />Örnek Excel ({spec.label})
            </button>
            <ol className="space-y-1.5 pt-1 text-xs text-slate-600">
              <li><strong className="text-slate-800">2.</strong> Doldurup buraya bırakın.</li>
              <li><strong className="text-slate-800">3.</strong> Her satır otomatik kontrol edilir; hiçbir şey yazılmaz.</li>
              <li><strong className="text-slate-800">4.</strong> Sonucu inceleyip <em>Yükle</em>&apos;ye basın.</li>
            </ol>
          </aside>
        </div>
      </AdminCard>

      {sheet && sheet.rows.length && !sheet.missingColumns.length ? (
        <AdminCard>
          <div className="space-y-4 p-5">
            {phase === "checking" || phase === "applying" ? (
              <ProgressBar label={phase === "checking" ? "Satırlar doğrulanıyor (henüz bir şey yazılmıyor)" : "Yükleniyor"} done={progress.done} total={progress.total}
                onCancel={() => abort.current?.abort()} tone={phase === "applying" ? "green" : "violet"} />
            ) : null}
            <StatTiles items={phase === "done"
              ? [{ label: "Satır", value: stats.total }, { label: op === "create" ? "Eklendi" : "Güncellendi", value: stats.written, tone: "green" }, { label: "Değişiklik yok", value: stats.unchanged }, { label: "Hatalı", value: stats.errors, tone: "red" }]
              : [{ label: "Satır", value: stats.total }, { label: `Hazır (${verb})`, value: stats.ready, tone: "green" }, { label: "Değişiklik yok", value: stats.unchanged }, { label: "Hatalı", value: stats.errors, tone: "red" }]} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                {phase === "checked" ? (stats.ready ? <><CheckCircle2 className="mr-1 inline size-4 text-emerald-600" />Doğrulama bitti: <strong>{stats.ready}</strong> satır {verb}{stats.errors ? `, ${stats.errors} hatalı satır atlanacak` : ""}.</> : "Yüklenecek geçerli satır yok; hataları düzeltip dosyayı yeniden seçin.") : null}
                {phase === "done" ? <>İşlem tamamlandı.{jobId ? " Ayrıntılar Geçmiş sekmesinde." : ""}</> : null}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => downloadReport(`rapor-${sheet.fileName.replace(/\.\w+$/, "")}.csv`, rows)} disabled={busy}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Download className="size-4" />Rapor (CSV)</button>
                {phase !== "done" ? (
                  <button type="button" onClick={() => setConfirm(true)} disabled={phase !== "checked" || !stats.ready}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:cursor-not-allowed disabled:opacity-50">
                    <Upload className="size-4" />Yükle ({stats.ready})
                  </button>
                ) : (
                  <button type="button" onClick={reset} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">Yeni dosya</button>
                )}
              </div>
            </div>
            <ResultsTable results={rows} keyLabel={spec.needsKey ? MATCH_KEYS[key].label : "SKU"} />
          </div>
        </AdminCard>
      ) : null}

      <AdminConfirmDialog open={confirm} title={`${stats.ready} satır ${verb}`}
        description={`${spec.title}: doğrulanan ${stats.ready} satır yazılacak${stats.errors ? `, ${stats.errors} hatalı satır atlanacak` : ""}. Her değişiklik denetim kayıtlarına işlenir.`}
        confirmLabel="Evet, yükle" tone="primary" onConfirm={apply} onCancel={() => setConfirm(false)} />
      {phase === "done" && stats.errors ? <p className="text-xs text-slate-500"><AdminBadge tone="amber">İpucu</AdminBadge> Hatalı satırları raporda görüp yalnız onları içeren bir dosyayla tekrar yükleyebilirsiniz.</p> : null}
    </div>
  );
}
