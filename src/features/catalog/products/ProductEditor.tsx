"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Save, Sparkles, Trash2 } from "lucide-react";
import { ClientApiError } from "@/lib/api-client";
import { productsApi } from "./api";
import { notify } from "@/lib/toast";
import { statusMeta } from "@/lib/product-rules";
import type { ProductEditorData, ProductMeta } from "@/modules/catalog";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminBadge } from "@/components/admin/ui";
import { MediaGallery } from "@/features/media/MediaGallery";
import { type FormState, type Errors, fromData, toPayload } from "./editor/form-state";
import { type SectionId, SECTIONS, SECTION_OF, type Ctx, validate } from "./editor/validation";
import { SectionShell } from "./editor/fields";
import { GeneralSection } from "./editor/GeneralSection";
import { RelationsSection } from "./editor/RelationsSection";
import { VariantsSection } from "./editor/VariantsSection";
import { AttributesSection } from "./editor/AttributesSection";
import { SeoSection } from "./editor/SeoSection";
import { AiProductDrawer, type AiApply } from "./editor/AiProductDrawer";

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------
/** `ai`: the shop's AI provider when one is configured — enables "AI ile ürün ekle". */
export function ProductEditor({ initial, meta, canPublish, ai = null }: { initial: ProductEditorData | null; meta: ProductMeta; canPublish: boolean; ai?: { providerLabel: string } | null }) {
  const router = useRouter();
  const isEdit = !!initial;
  const [form, setForm] = useState<FormState>(() => fromData(initial));
  const [initialJson] = useState(() => JSON.stringify(fromData(initial)));
  const [step, setStep] = useState(0);
  const [visited, setVisited] = useState<Set<SectionId>>(() => new Set(isEdit ? SECTIONS.map((s) => s.id) : ["general"]));
  const [attempted, setAttempted] = useState<Set<SectionId>>(new Set());
  const [serverErrors, setServerErrors] = useState<Errors>({});
  // `shake` re-keys the panel; `blocked` decides whether it shakes (refused step) or eases in (normal move).
  const [shake, setShake] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirm, setConfirm] = useState<"leave" | "delete" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // Re-keyed on every open: each "AI ile ürün ekle" session starts empty.
  const [aiSession, setAiSession] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);

  const ctx: Ctx = useMemo(() => ({ meta, canPublish, wasPublished: initial?.status === "published" }), [meta, canPublish, initial?.status]);
  const clientErrors = useMemo(() => validate(form, ctx), [form, ctx]);
  const errorsBySection = useMemo(() => {
    const c: Partial<Record<SectionId, number>> = {};
    for (const k of Object.keys(clientErrors)) c[SECTION_OF(k)] = (c[SECTION_OF(k)] ?? 0) + 1;
    return c;
  }, [clientErrors]);

  const current = SECTIONS[step]!;
  const dirty = JSON.stringify(form) !== initialJson;
  const patch = useCallback((p: Partial<FormState>) => setForm((s) => ({ ...s, ...p })), []);
  // Errors show after the user tried to leave/save a step (or the server rejected a field) and update live.
  const fe = (k: string) => serverErrors[k]?.[0] ?? (attempted.has(SECTION_OF(k)) ? clientErrors[k]?.[0] : undefined);

  // Warn before closing the tab with unsaved work.
  useEffect(() => {
    if (!dirty || saving) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, saving]);

  // After a blocked step change, bring the first invalid control into view and focus it.
  useEffect(() => {
    if (!shake) return;
    const el = contentRef.current?.querySelector<HTMLElement>("[aria-invalid='true'], [data-invalid='true']");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el?.matches("input,select,textarea,button") ? el : el?.querySelector<HTMLElement>("input,select,textarea,button"))?.focus({ preventScroll: true });
  }, [shake, step]);

  const firstInvalid = (upTo: number) => SECTIONS.findIndex((s, i) => i < upTo && (errorsBySection[s.id] ?? 0) > 0);

  const goTo = (target: number) => {
    if (target === step || target < 0 || target >= SECTIONS.length) return;
    if (target > step) {
      const bad = firstInvalid(target);
      if (bad >= 0) {
        const s = SECTIONS[bad]!;
        setAttempted((a) => new Set(a).add(s.id));
        setStep(bad);
        setBlocked(true);
        setShake((n) => n + 1);
        notify.warning(`“${s.label}” bölümünde eksik alanlar var`, { id: "step-blocked", description: "Devam etmek için işaretli alanları doldurun." });
        return;
      }
    }
    setBlocked(false);
    setStep(target);
    setVisited((v) => new Set(v).add(SECTIONS[target]!.id));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (saving || uploading) return;
    const bad = firstInvalid(SECTIONS.length);
    if (bad >= 0) {
      setAttempted(new Set(SECTIONS.map((s) => s.id)));
      setStep(bad);
      setBlocked(true);
      setShake((n) => n + 1);
      notify.warning(isEdit ? "Güncellemeden önce eksikleri tamamlayın" : "Oluşturmadan önce eksikleri tamamlayın", { id: "save-blocked", description: `İlk eksik: ${SECTIONS[bad]!.label}` });
      return;
    }
    setSaving(true);
    setServerErrors({});
    try {
      const r = initial
        ? await productsApi.update(initial.id, toPayload(form), initial.updatedAt)
        : await productsApi.create(toPayload(form));
      if (r.data.archivedVariants.length) {
        notify.info("Bazı varyantlar arşivlendi", { description: `${r.data.archivedVariants.join(", ")} geçmişi olduğu için silinmedi, pasife alındı.` });
      }
      notify.success(isEdit ? "Ürün güncellendi" : "Ürün oluşturuldu", { description: form.name.trim() });
      router.push(`/admin/urunler?vurgula=${encodeURIComponent(r.data.id)}`);
    } catch (err) {
      if (err instanceof ClientApiError && Object.keys(err.fieldErrors).length) {
        setServerErrors(err.fieldErrors);
        const first = SECTIONS.findIndex((s) => s.id === SECTION_OF(Object.keys(err.fieldErrors)[0]!));
        if (first >= 0) setStep(first);
        setBlocked(true);
        setShake((n) => n + 1);
      }
      notify.error(err, { fallback: "Ürün kaydedilemedi." });
      setSaving(false);
    }
  };

  /** AI draft → form. Only returned fields change; photos join the gallery (first one becomes the cover if none). */
  const applyAi = ({ result, images }: AiApply) => {
    const d = result.draft;
    setForm((s) => {
      const known = new Set(s.media.map((m) => m.mediaId));
      const media = [...s.media, ...images.filter((i) => !known.has(i.mediaId))];
      return {
        ...s,
        ...(d.name ? { name: d.name } : {}),
        ...(d.shortDescription ? { shortDescription: d.shortDescription } : {}),
        ...(d.descriptionHtml ? { descriptionHtml: d.descriptionHtml } : {}),
        ...(d.seo ? { seo: { ...s.seo, metaTitle: d.seo.metaTitle || s.seo.metaTitle, metaDescription: d.seo.metaDescription || s.seo.metaDescription } } : {}),
        media,
        primaryMediaId: s.primaryMediaId ?? media[0]?.mediaId ?? null,
      };
    });
    setAiOpen(false);
    notify.success("AI içeriği forma eklendi", { description: "Alanları kontrol edip ürünü kaydedin." });
  };

  const leave = () => (dirty && !saving ? setConfirm("leave") : router.push("/admin/urunler"));

  const remove = async () => {
    if (!initial) return;
    setDeleting(true);
    try {
      await productsApi.remove(initial.id);
      notify.success("Ürün silindi", { description: initial.name });
      router.push("/admin/urunler");
    } catch (err) {
      setConfirm(null);
      setDeleting(false);
      notify.error(err, { fallback: "Ürün silinemedi." });
    }
  };

  const st = statusMeta(form.status);
  const last = step === SECTIONS.length - 1;
  const busy = saving || uploading;
  const progress = ((step + 1) / SECTIONS.length) * 100;

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-4">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={leave} className="mb-2 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800">
            <ArrowLeft className="h-4 w-4" /> Ürünler
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900">{isEdit ? form.name || "Ürün" : "Yeni ürün"}</h1>
            <AdminBadge tone={st.tone}>{st.label}</AdminBadge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {initial ? <>/urun/{initial.slug} · son güncelleme {new Date(initial.updatedAt).toLocaleString("tr-TR")}</> : "Adımları sırayla tamamlayın; zorunlu alanlar doldurulmadan sonraki adıma geçilmez."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ai ? (
            <button type="button" onClick={() => { setAiSession((n) => n + 1); setAiOpen(true); }}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-linear-to-r from-[#7367f0] to-[#a29bfe] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 transition hover:brightness-105">
              <Sparkles className="h-4 w-4" /> AI ile ürün ekle
            </button>
          ) : null}
          {initial ? (
            <Link href={`/urun/${initial.slug}`} target="_blank" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
              Mağazada gör
            </Link>
          ) : null}
        </div>
      </div>

      {/* Sticky step tabs */}
      <div className="sticky top-18 z-30">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-[0_8px_30px_-12px_rgb(15_23_42/0.18)] backdrop-blur-xl">
          <ol role="tablist" aria-label="Ürün bölümleri" className="no-scrollbar flex overflow-x-auto">
            {SECTIONS.map((s, i) => {
              const on = i === step;
              const errs = errorsBySection[s.id] ?? 0;
              const done = visited.has(s.id) && errs === 0 && (isEdit || i < step || attempted.has(s.id));
              const flagged = errs > 0 && (attempted.has(s.id) || Object.keys(serverErrors).some((k) => SECTION_OF(k) === s.id));
              return (
                <li key={s.id} role="presentation" className="flex flex-1 items-center">
                  <button type="button" role="tab" aria-selected={on} aria-controls="product-step-panel" onClick={() => goTo(i)}
                    className={`group flex w-full min-w-max items-center gap-3 px-4 py-3.5 text-left transition-colors sm:min-w-0 ${on ? "bg-indigo-50/60" : "hover:bg-slate-50"}`}>
                    <span className={`grid size-8 flex-none place-items-center rounded-full text-xs font-bold transition-all duration-300 ${
                      flagged ? "bg-red-500 text-white" : on ? "bg-[#7367f0] text-white shadow-md shadow-[#7367f0]/40" : done ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500"
                    }`}>
                      {flagged ? <AlertCircle className="h-4 w-4" /> : done && !on ? <Check className="h-4 w-4" /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate text-sm ${on ? "font-semibold text-slate-900" : "font-medium text-slate-600"}`}>{s.label}</span>
                      <span className="hidden truncate text-[11px] text-slate-400 lg:block">{flagged ? <span className="text-red-500">{errs} eksik alan</span> : s.hint}</span>
                    </span>
                  </button>
                  {i < SECTIONS.length - 1 ? <span className="hidden h-px w-4 flex-none bg-slate-200 xl:block" aria-hidden /> : null}
                </li>
              );
            })}
          </ol>
          <div className="h-1 bg-slate-100" aria-hidden><div className="h-full rounded-r-full bg-linear-to-r from-[#7367f0] to-[#a29bfe] transition-[width] duration-500 ease-out-expo" style={{ width: `${progress}%` }} /></div>
        </div>
      </div>

      {/* Step content */}
      <div id="product-step-panel" role="tabpanel" aria-label={current.label} ref={contentRef}
        key={`${current.id}-${shake}`} className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 ${blocked ? "animate-shake" : "animate-page-in"}`}>
        {current.id === "general" && <GeneralSection form={form} patch={patch} fe={fe} canPublish={canPublish} wasPublished={ctx.wasPublished} />}
        {current.id === "relations" && <RelationsSection form={form} patch={patch} fe={fe} meta={meta} />}
        {current.id === "media" && (
          <SectionShell title="Görseller" desc="Ürün galerisi. Sıralama vitrindeki sırayı belirler." required={form.status === "published"}>
            <div data-invalid={!!fe("media")}>
              <MediaGallery folder="products" items={form.media} primaryId={form.primaryMediaId}
                onChange={(media, primaryMediaId) => patch({ media, primaryMediaId })} onUploadingChange={setUploading} error={fe("media")} />
            </div>
          </SectionShell>
        )}
        {current.id === "variants" && <VariantsSection form={form} setForm={setForm} fe={fe} axisAttrs={meta.attributes.filter((a) => a.isVariantAxis)} onUploadingChange={setUploading} />}
        {current.id === "attributes" && <AttributesSection form={form} patch={patch} fe={fe} meta={meta} />}
        {current.id === "seo" && <SeoSection form={form} patch={patch} fe={fe} />}
      </div>

      {/* Floating action bar */}
      <div className="sticky bottom-4 z-30">
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-[0_16px_40px_-14px_rgb(15_23_42/0.35)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium text-slate-700">Adım {step + 1}/{SECTIONS.length}</span>
            <span className="hidden text-slate-400 sm:inline">· {current.label}</span>
            <span className={`inline-flex items-center gap-1.5 text-xs transition-opacity ${dirty ? "text-amber-600 opacity-100" : "opacity-0"}`} aria-live="polite">
              <span className="size-1.5 rounded-full bg-amber-500" /> {isEdit ? "Güncellenmemiş değişiklikler" : "Henüz oluşturulmadı"}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isEdit ? (
              <button type="button" onClick={() => setConfirm("delete")} disabled={busy}
                className="mr-auto inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 sm:mr-2">
                <Trash2 className="h-4 w-4" /> Sil
              </button>
            ) : null}
            <button type="button" onClick={() => goTo(step - 1)} disabled={step === 0}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">
              <ArrowLeft className="h-4 w-4" /> Geri
            </button>
            {!last ? (
              <button type="button" onClick={() => goTo(step + 1)}
                className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition ${isEdit ? "border border-slate-200 text-slate-700 hover:bg-slate-50" : "bg-[#7367f0] text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df]"}`}>
                İleri <ArrowRight className="h-4 w-4" />
              </button>
            ) : null}
            {isEdit || last ? (
              <button type="button" onClick={save} disabled={busy}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 transition hover:bg-[#6559df] disabled:opacity-60">
                <Save className="h-4 w-4" />
                {saving ? (isEdit ? "Güncelleniyor…" : "Oluşturuluyor…") : uploading ? "Görseller yükleniyor…" : isEdit ? "Güncelle" : "Ürünü oluştur"}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {ai ? <AiProductDrawer key={aiSession} open={aiOpen} providerLabel={ai.providerLabel} onClose={() => setAiOpen(false)} onApply={applyAi} /> : null}

      <AdminConfirmDialog open={confirm === "leave"} tone="primary" title={isEdit ? "Değişiklikler güncellenmedi" : "Ürün oluşturulmadı"}
        description="Sayfadan ayrılırsanız yaptığınız değişiklikler kaybolacak." confirmLabel={isEdit ? "Güncellemeden çık" : "Oluşturmadan çık"}
        onConfirm={() => { setConfirm(null); router.push("/admin/urunler"); }} onCancel={() => setConfirm(null)} />
      <AdminConfirmDialog open={confirm === "delete"} title="Ürün silinsin mi?"
        description={`"${form.name}" ve tüm varyantları, fiyatları ve görsel bağlantıları kalıcı olarak silinecek. Sipariş veya stok geçmişi olan ürünler silinemez; onları "Arşivlendi" durumuna alın.`}
        confirmLabel="Evet, sil" busyLabel="Siliniyor…" busy={deleting} onConfirm={remove} onCancel={() => setConfirm(null)} />
    </div>
  );
}
