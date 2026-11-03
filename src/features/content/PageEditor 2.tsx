"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, History, Info, Save, Scale, Trash2, TriangleAlert } from "lucide-react";
import { notify } from "@/lib/toast";
import { slugify } from "@/lib/slug";
import { useFieldErrors } from "@/lib/use-field-errors";
import { sanitizeRichHtml } from "@/core/security/sanitize-html";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Counter, Field, inputCls } from "@/components/admin/form";
import { RichTextEditor, type EditorVariable } from "@/components/admin/RichTextEditor";
import {
  FOOTER_COLUMNS, LEGAL_TYPES, LEGAL_TYPE_KEYS, PAGE_KINDS, PAGE_STATUSES, pageHref,
  type FooterColumn, type LegalType, type PageDetail, type PageInput, type PageKind, type PageRevision, type PageStatus,
} from "@/modules/content/domain/page";
import { placeholdersIn, renderTemplate } from "@/modules/content/domain/template";
import { contentApi } from "./api";

type Form = {
  title: string; slug: string; summary: string; bodyHtml: string; kind: PageKind; legalType: LegalType | ""; status: PageStatus;
  footerColumn: FooterColumn | ""; footerOrder: string; metaTitle: string; metaDescription: string; noindex: boolean;
};

const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
const STATUS_HELP: Record<PageStatus, string> = {
  draft: "Yalnız panelde görünür.",
  published: "Sitede yayında; footer sütunu seçildiyse orada listelenir.",
  archived: "Yayından kalkar; sürüm geçmişi saklanır.",
};

const fromPage = (p: PageDetail | null, seed?: Partial<Form>): Form => ({
  title: p?.title ?? "", slug: p?.slug ?? "", summary: p?.summary ?? "", bodyHtml: p?.bodyHtml ?? "",
  kind: p?.kind ?? "general", legalType: p?.legalType ?? "", status: p?.status ?? "draft",
  footerColumn: p?.footerColumn ?? "", footerOrder: String(p?.footerOrder ?? 0),
  metaTitle: p?.seo.metaTitle ?? "", metaDescription: p?.seo.metaDescription ?? "", noindex: p?.seo.noindex ?? false,
  ...seed,
});

/**
 * Create / edit a content page. Body placeholders ({{firma.unvan}} …) are previewed with the current Site ayarları
 * values; empty ones are highlighted so a legal text is never published with blanks unnoticed.
 */
export function PageEditor({ page, revisions = [], seed, variables, values }: {
  page: PageDetail | null;
  revisions?: PageRevision[];
  /** Prefill for a new page (legal template). */
  seed?: Partial<Form>;
  variables: EditorVariable[];
  values: Record<string, string>;
}) {
  const router = useRouter();
  const mode = page ? "edit" : "create";
  const [initial] = useState(() => fromPage(page, seed));
  const [form, setForm] = useState<Form>(initial);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [revisionView, setRevisionView] = useState<{ version: number; title: string; bodyHtml: string; createdAt: string } | null>(null);
  const errors = useFieldErrors();
  const fe = errors.get;

  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

  useEffect(() => {
    if (!dirty || saving) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, saving]);

  const known = useMemo(() => new Set([...variables.map((v) => v.name), "sayfa.guncelleme"]), [variables]);
  const used = useMemo(() => placeholdersIn(form.bodyHtml), [form.bodyHtml]);
  const unknown = used.filter((n) => !known.has(n));
  const empty = used.filter((n) => known.has(n) && n !== "sayfa.guncelleme" && !values[n]?.trim());
  const preview = useMemo(() => {
    const vars = { ...values, "sayfa.guncelleme": dt.format(new Date()) };
    return renderTemplate(sanitizeRichHtml(form.bodyHtml), vars, (name) => `<mark title="Site ayarlarında boş">[${name}]</mark>`).html;
  }, [form.bodyHtml, values]);
  const labelOf = (name: string) => variables.find((v) => v.name === name)?.label ?? name;
  const slugPreview = slugify(form.slug.trim() || form.title);
  const isLegal = form.kind === "legal";
  const canDelete = page && !(page.kind === "legal" && page.publishedAt);

  const payload = (): PageInput => ({
    title: form.title.trim(),
    slug: form.slug.trim() || undefined,
    kind: form.kind,
    legalType: isLegal ? (form.legalType || null) : null,
    summary: form.summary.trim() || null,
    bodyHtml: form.bodyHtml,
    status: form.status,
    footerColumn: form.footerColumn || null,
    footerOrder: Number(form.footerOrder) || 0,
    seo: { metaTitle: form.metaTitle.trim() || null, metaDescription: form.metaDescription.trim() || null, noindex: form.noindex },
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    errors.clear();
    try {
      const id = page
        ? (await contentApi.update(page.id, { ...payload(), expectedVersion: page.version }), page.id)
        : (await contentApi.create(payload())).data.id;
      router.push(`/admin/icerik?vurgula=${encodeURIComponent(id)}`);
      router.refresh();
    } catch (err) {
      const n = errors.fromError(err);
      notify.error(err, { description: n ? "İşaretli alanları kontrol edin." : undefined });
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!page) return;
    setDeleting(true);
    try {
      await contentApi.remove(page.id);
      notify.success("Sayfa silindi", { description: page.title });
      router.push("/admin/icerik");
      router.refresh();
    } catch (err) {
      notify.error(err);
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const openRevision = async (version: number) => {
    if (!page) return;
    try {
      setRevisionView((await contentApi.revision(page.id, version)).data);
    } catch (err) {
      notify.error(err, { fallback: "Sürüm yüklenemedi." });
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/admin/icerik" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" />İçerik yönetimi</Link>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-slate-900">{page ? page.title : "Yeni sayfa"}</h1>
          {page ? (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <AdminBadge tone={PAGE_STATUSES[page.status].tone}>{PAGE_STATUSES[page.status].label}</AdminBadge>
              <span>Sürüm {page.version} · {dt.format(new Date(page.updatedAt))}{page.updatedByName ? ` · ${page.updatedByName}` : ""}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {page?.status === "published" ? (
            <a href={pageHref(page.slug)} target="_blank" rel="noopener" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <ExternalLink className="size-4" />Sitede görüntüle
            </a>
          ) : null}
          {page ? (
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={!canDelete}
              title={canDelete ? undefined : "Yayınlanmış yasal metin silinemez; durumunu “Arşivde” yapın."}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
              <Trash2 className="size-4" />Sil
            </button>
          ) : null}
        </div>
      </div>

      {isLegal ? (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Scale className="mt-0.5 size-4 flex-none" aria-hidden />
          <span>Şablon metinler genel örnektir. Yayınlamadan önce firmanızın hukuk danışmanına kontrol ettirin. Her güncelleme yeni bir sürüm olarak saklanır; müşterinin onayladığı sürüm siparişiyle birlikte kaydedilir.</span>
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <AdminCard className="space-y-4 p-5">
            <Field id="pg-title" label="Başlık" required error={fe("title")}>
              <input id="pg-title" className={inputCls} value={form.title} maxLength={200} aria-invalid={!!fe("title")} onChange={(e) => patch({ title: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="pg-slug" label="Adres" error={fe("slug")} hint={slugPreview ? <>Sayfa adresi: <span className="font-mono text-slate-700">{pageHref(slugPreview)}</span></> : "Boş bırakılırsa başlıktan üretilir."}>
                <input id="pg-slug" className={inputCls} value={form.slug} maxLength={120} placeholder={slugify(form.title) || "otomatik-uretilir"}
                  aria-invalid={!!fe("slug")} onChange={(e) => patch({ slug: e.target.value })} />
              </Field>
              <Field id="pg-summary" label="Kısa özet" error={fe("summary")} hint={<Counter value={form.summary} max={500} />}>
                <input id="pg-summary" className={inputCls} value={form.summary} maxLength={500} aria-invalid={!!fe("summary")} onChange={(e) => patch({ summary: e.target.value })} />
              </Field>
            </div>
          </AdminCard>

          <AdminCard className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
              <h2 className="text-base font-semibold text-slate-900">İçerik</h2>
              <div role="tablist" aria-label="Görünüm" className="inline-flex rounded-lg bg-slate-100 p-0.5">
                {(["edit", "preview"] as const).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                    className={`h-8 rounded-md px-3 text-sm font-medium ${tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                    {t === "edit" ? "Düzenle" : "Önizleme"}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-5">
              {tab === "edit" ? (
                <RichTextEditor id="pg-body" value={form.bodyHtml} onChange={(html) => patch({ bodyHtml: html })} variables={variables} invalid={!!fe("bodyHtml")} describedBy="pg-body-help" />
              ) : (
                <div className="rounded-xl border border-slate-200 px-6 py-5">
                  <h1 className="text-2xl font-bold text-slate-900">{form.title || "Başlıksız sayfa"}</h1>
                  {form.summary ? <p className="mt-2 text-slate-600">{form.summary}</p> : null}
                  <div className="rich-text mt-5 text-sm text-slate-700 [&_mark]:rounded [&_mark]:bg-amber-100 [&_mark]:px-1 [&_mark]:text-amber-900" dangerouslySetInnerHTML={{ __html: preview }} />
                </div>
              )}
              <div id="pg-body-help" className="mt-3 space-y-2 text-xs">
                {fe("bodyHtml") ? <p className="text-red-600">{fe("bodyHtml")}</p> : null}
                {empty.length ? (
                  <p className="flex items-start gap-1.5 text-amber-700">
                    <TriangleAlert className="mt-px size-3.5 flex-none" aria-hidden />
                    <span>Site ayarlarında boş: {empty.map(labelOf).join(", ")}. Sayfada bu alanlar boş görünür — <Link href="/admin/ayarlar?grup=company" className="font-medium underline">Firma bilgilerini doldurun</Link>.</span>
                  </p>
                ) : null}
                {unknown.length ? (
                  <p className="flex items-start gap-1.5 text-red-600">
                    <TriangleAlert className="mt-px size-3.5 flex-none" aria-hidden />
                    <span>Tanınmayan değişken: {unknown.map((n) => `{{${n}}}`).join(", ")} — metinde olduğu gibi görünür. “Değişken” menüsünden seçin.</span>
                  </p>
                ) : null}
                {!empty.length && !unknown.length ? (
                  <p className="flex items-start gap-1.5 text-slate-500"><Info className="mt-px size-3.5 flex-none" aria-hidden />Firma unvanı, adres, iletişim gibi bilgileri “Değişken” menüsünden ekleyin; Site ayarları değişince metin kendiliğinden güncellenir.</p>
                ) : null}
              </div>
            </div>
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Arama motoru" subtitle="Boş bırakılırsa başlık ve özet kullanılır." />
            <div className="space-y-4 p-5">
              <Field id="pg-meta-title" label="Meta başlık" error={fe("seo.metaTitle")} hint={<Counter value={form.metaTitle} max={60} />}>
                <input id="pg-meta-title" className={inputCls} value={form.metaTitle} maxLength={120} onChange={(e) => patch({ metaTitle: e.target.value })} />
              </Field>
              <Field id="pg-meta-desc" label="Meta açıklama" error={fe("seo.metaDescription")} hint={<Counter value={form.metaDescription} max={160} />}>
                <textarea id="pg-meta-desc" className={`${inputCls} min-h-20 py-2`} value={form.metaDescription} maxLength={320} onChange={(e) => patch({ metaDescription: e.target.value })} />
              </Field>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="Arama sonucu önizlemesi">
                <p className="truncate text-xs text-emerald-700">{pageHref(slugPreview || "sayfa")}</p>
                <p className="truncate text-base text-[#1a0dab]">{form.metaTitle || form.title || "Sayfa başlığı"}</p>
                <p className="line-clamp-2 text-sm text-slate-600">{form.metaDescription || form.summary || "Sayfa açıklaması burada görünür."}</p>
              </div>
              <label className="flex items-center gap-3 text-sm text-slate-700">
                <input type="checkbox" className="size-4 accent-[#7367f0]" checked={form.noindex} onChange={(e) => patch({ noindex: e.target.checked })} />
                Arama motorlarında gösterme (noindex)
              </label>
            </div>
          </AdminCard>
        </div>

        <div className="space-y-6 xl:sticky xl:top-20 xl:self-start">
          <AdminCard>
            <AdminCardTitle title="Yayın durumu" />
            <fieldset className="space-y-2 p-5">
              <legend className="sr-only">Yayın durumu</legend>
              {(Object.keys(PAGE_STATUSES) as PageStatus[]).map((s) => (
                <label key={s} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${form.status === s ? "border-[#7367f0] bg-[#7367f0]/5" : "border-slate-200 hover:bg-slate-50"}`}>
                  <input type="radio" name="status" value={s} checked={form.status === s} onChange={() => patch({ status: s })} className="mt-0.5 accent-[#7367f0]" />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">{PAGE_STATUSES[s].label}</span>
                    <span className="block text-xs text-slate-500">{STATUS_HELP[s]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Sayfa türü ve konumu" />
            <div className="space-y-4 p-5">
              <Field id="pg-kind" label="Tür" required error={fe("kind")}>
                <select id="pg-kind" className={inputCls} value={form.kind}
                  onChange={(e) => {
                    const kind = e.target.value as PageKind;
                    patch({ kind, legalType: kind === "legal" ? form.legalType : "" });
                  }}>
                  {(Object.entries(PAGE_KINDS) as [PageKind, string][]).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </Field>
              {isLegal ? (
                <Field id="pg-legal" label="Yasal metin türü" required error={fe("legalType")} hint="Her türden yalnız bir aktif sayfa olabilir.">
                  <select id="pg-legal" className={inputCls} value={form.legalType} aria-invalid={!!fe("legalType")} onChange={(e) => patch({ legalType: e.target.value as LegalType })}>
                    <option value="">Seçin</option>
                    {LEGAL_TYPE_KEYS.map((t) => <option key={t} value={t}>{LEGAL_TYPES[t].label}</option>)}
                  </select>
                </Field>
              ) : null}
              <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-3">
                <Field id="pg-footer" label="Footer sütunu" error={fe("footerColumn")}>
                  <select id="pg-footer" className={inputCls} value={form.footerColumn} onChange={(e) => patch({ footerColumn: e.target.value as FooterColumn | "" })}>
                    <option value="">Footer’da gösterme</option>
                    {(Object.entries(FOOTER_COLUMNS) as [FooterColumn, string][]).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </Field>
                <Field id="pg-order" label="Sıra" error={fe("footerOrder")}>
                  <input id="pg-order" type="number" inputMode="numeric" className={inputCls} value={form.footerOrder} disabled={!form.footerColumn} onChange={(e) => patch({ footerOrder: e.target.value })} />
                </Field>
              </div>
            </div>
          </AdminCard>

          {page && revisions.length ? (
            <AdminCard>
              <AdminCardTitle title="Sürüm geçmişi" subtitle="Her güncelleme ayrı sürüm olarak saklanır." />
              <ol className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {revisions.map((r) => (
                  <li key={r.version}>
                    <button type="button" onClick={() => openRevision(r.version)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50">
                      <History className="size-4 flex-none text-slate-400" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-800">Sürüm {r.version}{r.version === page.version ? " · güncel" : ""}</span>
                        <span className="block truncate text-xs text-slate-500">{dt.format(new Date(r.createdAt))}{r.createdByName ? ` · ${r.createdByName}` : ""}</span>
                      </span>
                      <AdminBadge tone={PAGE_STATUSES[r.status].tone}>{PAGE_STATUSES[r.status].label}</AdminBadge>
                    </button>
                  </li>
                ))}
              </ol>
            </AdminCard>
          ) : null}
        </div>
      </div>

      <div className="sticky bottom-4 z-30">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <p className="text-sm text-slate-500">{dirty ? "Kaydedilmemiş değişiklikler var." : "Değişiklik yok."}</p>
          <div className="flex gap-2">
            <Link href="/admin/icerik" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Vazgeç</Link>
            <button type="submit" disabled={saving || (mode === "edit" && !dirty)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60">
              <Save className="size-4" />
              {saving ? "Bekleyin…" : mode === "create" ? "Sayfayı oluştur" : "Güncelle"}
            </button>
          </div>
        </div>
      </div>

      <AdminConfirmDialog
        open={confirmDelete}
        title="Sayfa silinsin mi?"
        description={page ? `“${page.title}” ve tüm sürüm geçmişi kalıcı olarak silinecek; footer'daki bağlantısı da kalkar.` : undefined}
        confirmLabel="Evet, sil"
        busyLabel="Siliniyor…"
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />

      {revisionView ? (
        <RevisionDialog
          revision={revisionView}
          onClose={() => setRevisionView(null)}
          onRestore={() => {
            patch({ title: revisionView.title, bodyHtml: revisionView.bodyHtml });
            setRevisionView(null);
            setTab("edit");
            notify.success(`Sürüm ${revisionView.version} editöre yüklendi`, { description: "Kalıcı olması için “Güncelle”ye basın." });
          }}
        />
      ) : null}
    </form>
  );
}

function RevisionDialog({ revision, onClose, onRestore }: { revision: { version: number; title: string; bodyHtml: string; createdAt: string }; onClose: () => void; onRestore: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="rev-title">
      <button type="button" aria-label="Kapat" className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 id="rev-title" className="text-base font-semibold text-slate-900">Sürüm {revision.version}: {revision.title}</h2>
          <p className="text-xs text-slate-500">{dt.format(new Date(revision.createdAt))}</p>
        </div>
        <div className="rich-text overflow-y-auto px-6 py-5 text-sm text-slate-700" dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(revision.bodyHtml) }} />
        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-3">
          <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Kapat</button>
          <button type="button" onClick={onRestore} className="inline-flex min-h-10 items-center rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df]">Bu sürümü editöre yükle</button>
        </div>
      </div>
    </div>
  );
}
