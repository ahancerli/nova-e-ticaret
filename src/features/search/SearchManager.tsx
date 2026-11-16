"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AlertTriangle, ArrowLeftRight, ArrowRight, CircleCheck, CircleOff, Eye, EyeOff, Plus, RefreshCw, Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import type { SearchAdminView, SearchTermRow, SynonymKind } from "@/modules/search/domain/search";
import { searchAdminApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const when = (iso: string | null) => (iso ? dt.format(new Date(iso)) : "henüz yok");
const splitWords = (text: string) => text.split(/[,;\n]/).map((w) => w.trim()).filter(Boolean);
const iconBtn = "grid size-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40";

/**
 * Katalog › Arama. What the shop can steer about search: whether the engine is in step with the catalog, which words
 * mean the same (the usual fix for a search that finds nothing), and what customers actually type.
 */
export function SearchManager({ view }: { view: SearchAdminView }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const wordsInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<{ kind: SynonymKind; term: string; words: string }>({ kind: "group", term: "", words: "" });
  const { engine } = view;
  const off = !engine.configured;
  const behind = engine.reachable && engine.documents !== null && engine.documents !== view.publishedProducts;

  const run = async (key: string, work: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(key);
    try {
      await work();
      router.refresh();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback });
    } finally {
      setBusy(null);
    }
  };

  const addSynonym = (e: React.FormEvent) => {
    e.preventDefault();
    errors.clear();
    void run("synonym", async () => {
      await searchAdminApi.addSynonym({ kind: form.kind, term: form.kind === "oneway" ? form.term.trim() : null, words: splitWords(form.words) });
      notify.success("Eş anlamlı eklendi", { description: off ? "Arama motoru kurulduğunda kullanılacak." : "Aramalarda hemen geçerli." });
      setForm({ kind: form.kind, term: "", words: "" });
    }, "Eş anlamlı eklenemedi.");
  };
  /** A search that found nothing usually needs a synonym: start one for that term. */
  const startSynonymFor = (term: string) => {
    setForm({ kind: "oneway", term, words: "" });
    errors.clear();
    wordsInput.current?.focus();
    wordsInput.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Arama"
        subtitle="Mağazadaki arama kutusu: yazım hatası toleransı, eş anlamlılar ve müşterilerin ne aradığı."
        actions={
          <button type="button" disabled={off || busy !== null}
            onClick={() => run("reindex", async () => { const r = await searchAdminApi.reindex(); notify.success("Dizin yeniden kuruldu", { description: `${r.data.documents} ürün dizinde.` }); }, "Dizin yeniden kurulamadı.")}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`size-4 ${busy === "reindex" ? "animate-spin" : ""}`} />{busy === "reindex" ? "Yeniden kuruluyor…" : "Dizini yeniden kur"}
          </button>
        } />

      <AdminCard>
        <AdminCardTitle title="Arama motoru"
          actions={off ? <AdminBadge tone="slate">Kurulu değil</AdminBadge> : engine.reachable ? <AdminBadge tone="green">Çalışıyor</AdminBadge> : <AdminBadge tone="red">Ulaşılamıyor</AdminBadge>} />
        <div className="space-y-4 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className={`grid size-11 flex-none place-items-center rounded-xl ${engine.reachable ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
              {engine.reachable ? <CircleCheck className="size-5" /> : <CircleOff className="size-5" />}
            </span>
            <p className="pt-0.5 text-sm text-slate-600">
              {off ? "Meilisearch bağlı değil (sunucuda MEILI_URL tanımsız). Arama çalışıyor, ancak basit eşleşmeyle: yazım hatası toleransı, eş anlamlılar ve alakaya göre sıralama devrede değil."
                : engine.reachable ? "Aramalar Meilisearch üzerinden yanıtlanıyor. Fiyat, stok ve kampanyalar her aramada veritabanından canlı okunur; dizinde yalnız aranacak metin tutulur."
                : "Meilisearch yanıt vermiyor. Arama, motor geri gelene kadar basit eşleşmeyle çalışmaya devam ediyor; müşteriler hata görmez."}
            </p>
          </div>
          {!off && (
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              {[
                ["Dizindeki ürün", engine.documents === null ? "—" : `${engine.documents} / ${view.publishedProducts}`],
                ["Bekleyen değişiklik", engine.indexing ? "işleniyor…" : String(view.pendingChanges)],
                ["Son eşitleme", when(view.lastSyncAt)],
                ["Son tam kurulum", when(view.lastFullAt)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {!off && (view.lastError || behind) && (
            <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 flex-none" />
              <span>{view.lastError ? `Son eşitleme başarısız oldu (${view.lastError}). Motor çalışıyorsa bir dakika içinde kendiliğinden yeniden denenir.` : "Dizin yayındaki ürün sayısıyla aynı değil. Değişiklikler bir dakika içinde işlenir; fark kapanmazsa dizini yeniden kurun."}</span>
            </p>
          )}
        </div>
      </AdminCard>

      <AdminCard>
        <AdminCardTitle title="Eş anlamlılar" subtitle="Müşterinin yazdığı kelime ile katalogdaki kelime farklıysa burada eşleştirin: “süveter” arayan “kazak” ürünlerini de görsün." />
        <form onSubmit={addSynonym} noValidate className="space-y-4 border-b border-slate-200 px-5 py-5">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Eş anlamlı türü">
            {([["group", ArrowLeftRight, "Karşılıklı", "Kelimelerin hepsi birbirinin yerine geçer: kazak, süveter, triko."], ["oneway", ArrowRight, "Tek yönlü", "Yalnız aranan kelime karşılıkları da bulur: “telefon” arayan “akıllı telefon”u da görür."]] as const).map(([kind, Icon, title, note]) => {
              const on = form.kind === kind;
              return (
                <button key={kind} type="button" role="radio" aria-checked={on} onClick={() => { setForm((f) => ({ ...f, kind })); errors.clear(); }}
                  className={`rounded-xl border p-3.5 text-left transition ${on ? "border-[#7367f0] bg-indigo-50/60 ring-2 ring-[#7367f0]/15" : "border-slate-200 hover:bg-slate-50"}`}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Icon className={`size-4 ${on ? "text-[#7367f0]" : "text-slate-400"}`} />{title}</span>
                  <span className="mt-1 block text-xs text-slate-600">{note}</span>
                </button>
              );
            })}
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-start">
            {form.kind === "oneway" && (
              <Field id="syn-term" label="Aranan kelime" required error={errors.get("term")}>
                <input id="syn-term" className={`${inputCls} h-10`} value={form.term} maxLength={40} onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))} aria-invalid={errors.has("term")} />
              </Field>
            )}
            <Field id="syn-words" label={form.kind === "oneway" ? "Karşılıkları" : "Kelimeler"} required error={errors.get("words")} hint="Virgülle ayırın." className={form.kind === "oneway" ? "" : "sm:col-span-2"}>
              <input id="syn-words" ref={wordsInput} className={`${inputCls} h-10`} value={form.words} placeholder={form.kind === "oneway" ? "akıllı telefon, cep telefonu" : "kazak, süveter, triko"}
                onChange={(e) => setForm((f) => ({ ...f, words: e.target.value }))} aria-invalid={errors.has("words")} />
            </Field>
            <button type="submit" disabled={busy !== null}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60 sm:mt-[1.375rem]">
              <Plus className="size-4" />{busy === "synonym" ? "Ekleniyor…" : "Ekle"}
            </button>
          </div>
        </form>
        {view.synonyms.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">Henüz eş anlamlı yok. Aşağıdaki “Sonuç bulunamayan aramalar” listesi nereden başlayacağınızı gösterir.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {view.synonyms.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                {s.kind === "oneway" ? <ArrowRight className="size-4 flex-none text-slate-400" aria-label="Tek yönlü" /> : <ArrowLeftRight className="size-4 flex-none text-slate-400" aria-label="Karşılıklı" />}
                <p className="min-w-0 flex-1 text-slate-800">{s.kind === "oneway" ? <><b className="font-semibold">{s.term}</b><span className="mx-2 text-slate-400">→</span></> : null}{s.words.join(", ")}</p>
                <button type="button" className={`${iconBtn} hover:text-red-600`} aria-label="Eş anlamlıyı sil" disabled={busy !== null}
                  onClick={() => run(`del:${s.id}`, async () => { await searchAdminApi.deleteSynonym(s.id); notify.success("Eş anlamlı silindi"); }, "Eş anlamlı silinemedi.")}><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <TermList title="Sonuç bulunamayan aramalar" subtitle="Müşteri aradı, hiçbir ürün çıkmadı. Ürün sizde varsa eş anlamlı ekleyin."
          empty="Sonuçsuz arama yok." rows={view.zeroResults} count={(t) => `${t.zeroResults} kez`}
          actions={(t) => (
            <>
              <button type="button" className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#7367f0] hover:bg-indigo-50" onClick={() => startSynonymFor(t.display)}>Eş anlamlı ekle</button>
              <button type="button" className={`${iconBtn} hover:text-red-600`} aria-label={`“${t.display}” kaydını sil`} disabled={busy !== null}
                onClick={() => run(`term:${t.term}`, () => searchAdminApi.updateTerm(t.term, "delete").then(() => undefined), "Terim silinemedi.")}><Trash2 className="size-4" /></button>
            </>
          )} />
        <TermList title="En çok arananlar" subtitle="Üç kez ve daha çok aranıp sonuç verenler, mağazada boş arama kutusunda “Popüler aramalar” olarak görünür."
          empty="Henüz arama yapılmadı." rows={view.popular} count={(t) => `${t.searches} arama, ${t.lastResultCount} ürün`}
          actions={(t) => (
            <button type="button" className={iconBtn} disabled={busy !== null} aria-label={t.hidden ? `“${t.display}” terimini mağazada göster` : `“${t.display}” terimini mağazada gizle`}
              onClick={() => run(`term:${t.term}`, () => searchAdminApi.updateTerm(t.term, t.hidden ? "show" : "hide").then(() => undefined), "Terim güncellenemedi.")}>
              {t.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          )} />
      </div>
    </div>
  );
}

function TermList({ title, subtitle, empty, rows, count, actions }: {
  title: string; subtitle: string; empty: string; rows: SearchTermRow[]; count: (t: SearchTermRow) => string; actions: (t: SearchTermRow) => React.ReactNode;
}) {
  return (
    <AdminCard>
      <AdminCardTitle title={title} subtitle={subtitle} />
      {rows.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">{empty}</p> : (
        <ul className="divide-y divide-slate-100">
          {rows.map((t) => (
            <li key={t.term} className="flex items-center gap-3 px-5 py-2 text-sm">
              <p className={`min-w-0 flex-1 truncate font-medium ${t.hidden ? "text-slate-400 line-through" : "text-slate-800"}`}>{t.display}</p>
              <span className="flex-none text-xs tabular-nums text-slate-500">{count(t)}</span>
              <span className="flex flex-none items-center gap-1">{actions(t)}</span>
            </li>
          ))}
        </ul>
      )}
    </AdminCard>
  );
}
