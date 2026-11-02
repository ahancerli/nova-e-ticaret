"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  AlertCircle, ArrowLeft, ArrowRight, Boxes, Check, FileText, FolderTree, Images, Lock, Plus, Save, Search, SlidersHorizontal, Sparkles, Trash2, Wand2,
} from "lucide-react";
import { api, ClientApiError } from "@/lib/api-client";
import { slugify } from "@/lib/slug";
import { formatMinor } from "@/lib/money";
import { notify } from "@/lib/toast";
import { PRODUCT_STATUSES, requiredAttributeIds, SKU_PATTERN, statusMeta } from "@/lib/product-rules";
import type { AttributeMeta, ProductEditorData, ProductMeta } from "@/modules/catalog";
import { Collapsible } from "@/components/ui/Collapsible";
import { AdminConfirmDialog } from "./AdminConfirmDialog";
import { AdminBadge } from "./ui";
import { MediaGallery, type GalleryItem } from "./MediaGallery";

// ---------------------------------------------------------------------------
// Form model (strings for numeric inputs; converted on save)
// ---------------------------------------------------------------------------
type Status = ProductEditorData["status"];
type VariantState = {
  key: string; id?: string; sku: string; barcode: string; name: string; options: Record<string, string>;
  price: string; compareAt: string; stock: string; isActive: boolean; isDefault: boolean;
  weightGrams: string; widthMm: string; heightMm: string; depthMm: string; reserved: number; locked: boolean;
  /** Stock as loaded: the server only writes stock that the user actually changed, guarded on this value. */
  loadedStock?: number;
};
type FormState = {
  name: string; slug: string; status: Status; shortDescription: string; descriptionHtml: string; taxRateBps: number;
  warrantyMonths: string; countryOfOrigin: string; accountingCode: string; manufacturerCode: string;
  brandId: string; categories: { id: string; primary: boolean }[]; media: GalleryItem[]; primaryMediaId: string | null;
  axes: string[]; variants: VariantState[]; attributes: Record<string, (string | number | boolean)[]>;
  seo: { metaTitle: string; metaDescription: string; canonicalUrl: string; noindex: boolean };
};
type Errors = Record<string, string[]>;

const STATUSES = PRODUCT_STATUSES;

const TAX_RATES = [0, 100, 1000, 2000];

const str = (v: number | string | null | undefined) => (v == null ? "" : String(v));
const minorToStr = (m: number | null | undefined) => (m == null ? "" : (m / 100).toFixed(2).replace(".", ","));
const strToMinor = (s: string): number | null => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};
const strToInt = (s: string): number | null => (s.trim() === "" ? null : /^\d+$/.test(s.trim()) ? Number.parseInt(s, 10) : NaN);
const uid = () => crypto.randomUUID();

const emptyVariant = (isDefault: boolean, options: Record<string, string> = {}): VariantState => ({
  key: uid(), sku: "", barcode: "", name: "", options, price: "", compareAt: "", stock: "0", isActive: true, isDefault,
  weightGrams: "", widthMm: "", heightMm: "", depthMm: "", reserved: 0, locked: false,
});

function fromData(d: ProductEditorData | null): FormState {
  if (!d) {
    return {
      name: "", slug: "", status: "draft", shortDescription: "", descriptionHtml: "", taxRateBps: 2000, warrantyMonths: "", countryOfOrigin: "",
      accountingCode: "", manufacturerCode: "", brandId: "", categories: [], media: [], primaryMediaId: null, axes: [],
      variants: [emptyVariant(true)], attributes: {}, seo: { metaTitle: "", metaDescription: "", canonicalUrl: "", noindex: false },
    };
  }
  return {
    name: d.name, slug: d.slug, status: d.status, shortDescription: d.shortDescription ?? "", descriptionHtml: d.descriptionHtml ?? "",
    taxRateBps: d.taxRateBps, warrantyMonths: str(d.warrantyMonths), countryOfOrigin: d.countryOfOrigin ?? "", accountingCode: d.accountingCode ?? "",
    manufacturerCode: d.manufacturerCode ?? "", brandId: d.brandId ?? "", categories: d.categories, media: d.media, primaryMediaId: d.primaryMediaId,
    axes: d.axes,
    variants: d.variants.map((v) => ({
      key: v.id, id: v.id, sku: v.sku, barcode: v.barcode ?? "", name: v.name ?? "", options: v.options, price: minorToStr(v.priceMinor),
      compareAt: minorToStr(v.compareAtMinor), stock: String(v.stock), isActive: v.isActive, isDefault: v.isDefault,
      weightGrams: str(v.weightGrams), widthMm: str(v.widthMm), heightMm: str(v.heightMm), depthMm: str(v.depthMm), reserved: v.reserved, locked: v.locked,
      loadedStock: v.stock,
    })),
    attributes: Object.fromEntries(d.attributes.map((a) => [a.attributeId, a.values])),
    seo: { metaTitle: d.seo.metaTitle ?? "", metaDescription: d.seo.metaDescription ?? "", canonicalUrl: d.seo.canonicalUrl ?? "", noindex: d.seo.noindex },
  };
}

function toPayload(f: FormState) {
  return {
    name: f.name.trim(), slug: f.slug.trim() || undefined, status: f.status, shortDescription: f.shortDescription || null, descriptionHtml: f.descriptionHtml || null,
    taxRateBps: f.taxRateBps, warrantyMonths: strToInt(f.warrantyMonths), countryOfOrigin: f.countryOfOrigin.trim() || null,
    accountingCode: f.accountingCode || null, manufacturerCode: f.manufacturerCode || null, brandId: f.brandId || null,
    categories: f.categories, media: f.media.map((m) => m.mediaId), primaryMediaId: f.primaryMediaId, axes: f.axes,
    variants: f.variants.map((v) => ({
      ...(v.id ? { id: v.id } : {}), sku: v.sku.trim(), barcode: v.barcode.trim() || null, name: v.name.trim() || null,
      options: Object.fromEntries(f.axes.map((a) => [a, v.options[a] ?? ""]).filter(([, o]) => o)),
      priceMinor: strToMinor(v.price) ?? 0, compareAtMinor: strToMinor(v.compareAt), stock: strToInt(v.stock) ?? 0,
      ...(v.loadedStock !== undefined ? { expectedStock: v.loadedStock } : {}),
      isActive: v.isActive, isDefault: v.isDefault,
      weightGrams: strToInt(v.weightGrams), widthMm: strToInt(v.widthMm), heightMm: strToInt(v.heightMm), depthMm: strToInt(v.depthMm),
    })),
    attributes: Object.entries(f.attributes).filter(([a]) => !f.axes.includes(a)).map(([attributeId, values]) => ({ attributeId, values: values.filter((v) => v !== "") })),
    seo: { metaTitle: f.seo.metaTitle || null, metaDescription: f.seo.metaDescription || null, canonicalUrl: f.seo.canonicalUrl || null, noindex: f.seo.noindex },
  };
}

// ---------------------------------------------------------------------------
// Steps + client-side validation (mirrors the server rules; the server stays authoritative)
// ---------------------------------------------------------------------------
type SectionId = "general" | "relations" | "media" | "variants" | "attributes" | "seo";
const SECTIONS: { id: SectionId; label: string; hint: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "general", label: "Genel bilgiler", hint: "Ad, durum, açıklama", icon: FileText },
  { id: "relations", label: "Marka & Kategori", hint: "Nerede listelenecek", icon: FolderTree },
  { id: "media", label: "Görseller", hint: "Galeri ve vitrin", icon: Images },
  { id: "variants", label: "Varyant & Stok", hint: "SKU, fiyat, stok", icon: Boxes },
  { id: "attributes", label: "Özellikler", hint: "Teknik bilgiler", icon: SlidersHorizontal },
  { id: "seo", label: "SEO", hint: "Arama görünümü", icon: Search },
];

const SECTION_OF = (key: string): SectionId => {
  if (key.startsWith("variants") || key === "axes") return "variants";
  if (key.startsWith("attributes")) return "attributes";
  if (key.startsWith("seo")) return "seo";
  if (key.startsWith("media") || key === "primaryMediaId") return "media";
  if (key === "brandId" || key.startsWith("categories")) return "relations";
  return "general";
};

type Ctx = { meta: ProductMeta; canPublish: boolean; wasPublished: boolean };

function validate(f: FormState, ctx: Ctx): Errors {
  const e: Errors = {};
  const add = (k: string, m: string) => void (e[k] ??= []).push(m);

  // general
  if (f.name.trim().length < 2) add("name", "Ürün adı en az 2 karakter olmalı.");
  if (f.slug.trim() && slugify(f.slug).length < 2) add("slug", "Geçerli bir slug girin.");
  if (f.countryOfOrigin && !/^[A-Z]{2}$/.test(f.countryOfOrigin)) add("countryOfOrigin", "İki harfli ülke kodu girin (örn. TR).");
  if (Number.isNaN(strToInt(f.warrantyMonths))) add("warrantyMonths", "Tam sayı girin.");
  if (f.status === "published" && !ctx.canPublish && !ctx.wasPublished) add("status", "Yayına alma yetkiniz yok.");
  // relations
  if (!f.categories.length) add("categories", "En az bir kategori seçin.");
  // media
  if (f.status === "published" && !f.media.length) add("media", "Yayındaki bir ürün için en az bir görsel ekleyin.");
  // variants
  if (!f.axes.length && f.variants.length > 1) add("axes", "Birden fazla varyant için en az bir eksen (Renk, Beden…) seçin.");
  const skus = new Map<string, number>(), combos = new Map<string, number>();
  f.variants.forEach((v, i) => {
    const k = (x: string) => `variants.${i}.${x}`;
    const sku = v.sku.trim().toUpperCase();
    if (!sku) add(k("sku"), "SKU gerekli.");
    else if (!SKU_PATTERN.test(sku)) add(k("sku"), "Harf, rakam, nokta, tire ve alt çizgi kullanın.");
    else if (skus.has(sku)) add(k("sku"), `SKU ${skus.get(sku)! + 1}. varyantta da var.`);
    skus.set(sku, i);
    const price = strToMinor(v.price), compare = strToMinor(v.compareAt);
    if (price == null) add(k("priceMinor"), "Satış fiyatı gerekli.");
    else if (Number.isNaN(price)) add(k("priceMinor"), "Geçerli bir tutar girin (örn. 1.299,90).");
    if (compare != null && (Number.isNaN(compare) || (price != null && !Number.isNaN(price) && compare <= price))) add(k("compareAtMinor"), "Eski fiyat, satış fiyatından büyük olmalı.");
    const stock = strToInt(v.stock);
    if (stock == null || Number.isNaN(stock)) add(k("stock"), "Stok adedi girin.");
    else if (stock < v.reserved) add(k("stock"), `Rezerve ${v.reserved} adetin altına inemez.`);
    for (const x of ["weightGrams", "widthMm", "heightMm", "depthMm"] as const) if (Number.isNaN(strToInt(v[x]))) add(k(x), "Tam sayı girin.");
    if (f.axes.length) {
      const missing = f.axes.filter((a) => !v.options[a]);
      missing.forEach((a) => add(k(`options.${a}`), "Seçim yapın."));
      if (!missing.length) {
        const key = f.axes.map((a) => v.options[a]).join("|");
        if (combos.has(key)) add(k("options"), `Bu kombinasyon ${combos.get(key)! + 1}. varyantta da var.`);
        combos.set(key, i);
      }
    }
  });
  // attributes required by the chosen categories
  const attrById = new Map(ctx.meta.attributes.map((a) => [a.id, a]));
  for (const id of requiredAttributeIds(ctx.meta, f.categories.map((c) => c.id))) {
    if (f.axes.includes(id)) continue;
    if (!(f.attributes[id] ?? []).some((v) => v !== "")) add(`attributes.${id}`, `${attrById.get(id)?.label ?? "Bu özellik"} bu kategori için zorunlu.`);
  }
  for (const [id, vals] of Object.entries(f.attributes)) {
    if (attrById.get(id)?.dataType === "number" && vals.some((v) => v !== "" && !Number.isFinite(Number(String(v).replace(",", "."))))) add(`attributes.${id}`, "Sayı girin.");
  }
  // seo
  if (f.seo.metaTitle.length > 120) add("seo.metaTitle", "En fazla 120 karakter.");
  if (f.seo.metaDescription.length > 320) add("seo.metaDescription", "En fazla 320 karakter.");
  if (f.seo.canonicalUrl && !/^(https:\/\/|\/)/.test(f.seo.canonicalUrl)) add("seo.canonicalUrl", "https:// veya / ile başlamalı.");
  return e;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------
export function ProductEditor({ initial, meta, canPublish }: { initial: ProductEditorData | null; meta: ProductMeta; canPublish: boolean }) {
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
      type Saved = { id: string; archivedVariants: string[] };
      const r = initial
        ? await api<Saved>(`/api/admin/products/${encodeURIComponent(initial.id)}`, { method: "PUT", json: { ...toPayload(form), expectedUpdatedAt: initial.updatedAt } })
        : await api<Saved>("/api/admin/products", { method: "POST", json: toPayload(form) });
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

  const leave = () => (dirty && !saving ? setConfirm("leave") : router.push("/admin/urunler"));

  const remove = async () => {
    if (!initial) return;
    setDeleting(true);
    try {
      await api(`/api/admin/products/${encodeURIComponent(initial.id)}`, { method: "DELETE" });
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
        {initial ? (
          <Link href={`/urun/${initial.slug}`} target="_blank" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
            Mağazada gör
          </Link>
        ) : null}
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
        {current.id === "variants" && <VariantsSection form={form} setForm={setForm} fe={fe} axisAttrs={meta.attributes.filter((a) => a.isVariantAxis)} />}
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

      <AdminConfirmDialog open={confirm === "leave"} tone="primary" title={isEdit ? "Değişiklikler güncellenmedi" : "Ürün oluşturulmadı"}
        description="Sayfadan ayrılırsanız yaptığınız değişiklikler kaybolacak." confirmLabel={isEdit ? "Güncellemeden çık" : "Oluşturmadan çık"}
        onConfirm={() => { setConfirm(null); router.push("/admin/urunler"); }} onCancel={() => setConfirm(null)} />
      <AdminConfirmDialog open={confirm === "delete"} title="Ürün silinsin mi?"
        description={`"${form.name}" ve tüm varyantları, fiyatları ve görsel bağlantıları kalıcı olarak silinecek. Sipariş veya stok geçmişi olan ürünler silinemez; onları "Arşivlendi" durumuna alın.`}
        confirmLabel="Evet, sil" busyLabel="Siliniyor…" busy={deleting} onConfirm={remove} onCancel={() => setConfirm(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------
type SectionProps = { form: FormState; patch: (p: Partial<FormState>) => void; fe: (k: string) => string | undefined };
const labelCls = "mb-1 block text-xs font-medium text-slate-600";
const inputCls = "input border-slate-200 text-sm text-slate-800 aria-[invalid=true]:border-red-400 aria-[invalid=true]:bg-red-50/40";
const Req = () => <span className="text-red-500" aria-hidden> *</span>;

function SectionShell({ title, desc, required, actions, children }: { title: string; desc?: string; required?: boolean; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}{required ? <Req /> : null}</h2>
          {desc ? <p className="mt-0.5 text-sm text-slate-500">{desc}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Field({ id, label, required, error, hint, className = "", children }: { id: string; label: string; required?: boolean; error?: string; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={labelCls}>{label}{required ? <Req /> : null}</label>
      {children}
      {error ? <p className="mt-1 flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3 w-3 flex-none" />{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={`tabular-nums ${value.length > max ? "text-red-600" : ""}`}>{value.length}/{max}</span>;
}

// --- Genel bilgiler ---------------------------------------------------------
function GeneralSection({ form, patch, fe, canPublish, wasPublished }: SectionProps & { canPublish: boolean; wasPublished: boolean }) {
  const slugPreview = slugify(form.slug.trim() || form.name);
  return (
    <SectionShell title="Genel bilgiler" desc="Vitrinde görünen temel ürün bilgileri ve muhasebe alanları.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="p-name" label="Ürün adı" required error={fe("name")} className="sm:col-span-2">
          <input id="p-name" className={inputCls} value={form.name} maxLength={200} onChange={(e) => patch({ name: e.target.value })} aria-invalid={!!fe("name")} />
        </Field>
        <Field id="p-slug" label="Slug (URL)" error={fe("slug")} hint={slugPreview ? <>Adres: <span className="font-mono text-slate-700">/urun/{slugPreview}</span></> : "Boşsa addan üretilir."}>
          <input id="p-slug" className={inputCls} value={form.slug} maxLength={160} placeholder={slugify(form.name) || "otomatik"} onChange={(e) => patch({ slug: e.target.value })} aria-invalid={!!fe("slug")} />
        </Field>
        <Field id="p-status" label="Durum" error={fe("status")} hint={!canPublish && !wasPublished ? <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" /> Yayına alma yetkiniz yok; “İncelemede” olarak gönderebilirsiniz.</span> : form.status === "published" ? "Yayındaki ürün için en az bir görsel gerekir." : undefined}>
          <select id="p-status" className={inputCls} value={form.status} onChange={(e) => patch({ status: e.target.value as Status })} aria-invalid={!!fe("status")}>
            {STATUSES.map((s) => <option key={s.value} value={s.value} disabled={s.value === "published" && !canPublish && !wasPublished}>{s.label}</option>)}
          </select>
        </Field>
        <Field id="p-short" label="Kısa açıklama" error={fe("shortDescription")} hint={<Counter value={form.shortDescription} max={300} />} className="sm:col-span-2">
          <textarea id="p-short" className={`${inputCls} min-h-20 py-2`} value={form.shortDescription} maxLength={300} onChange={(e) => patch({ shortDescription: e.target.value })} />
        </Field>
        <Field id="p-desc" label="Detaylı açıklama (HTML)" error={fe("descriptionHtml")} className="sm:col-span-2"
          hint="İzinli etiketler: p, br, strong, em, ul, ol, li, h2–h4, blockquote, a, table. Diğer her şey vitrinde otomatik temizlenir.">
          <textarea id="p-desc" className={`${inputCls} min-h-40 py-2 font-mono text-[13px]`} value={form.descriptionHtml} onChange={(e) => patch({ descriptionHtml: e.target.value })} />
        </Field>
        <Field id="p-tax" label="KDV oranı" required error={fe("taxRateBps")}>
          <select id="p-tax" className={inputCls} value={form.taxRateBps} onChange={(e) => patch({ taxRateBps: Number(e.target.value) })}>
            {TAX_RATES.map((r) => <option key={r} value={r}>%{r / 100}</option>)}
          </select>
        </Field>
        <Field id="p-warranty" label="Garanti (ay)" error={fe("warrantyMonths")}>
          <input id="p-warranty" inputMode="numeric" className={inputCls} value={form.warrantyMonths} onChange={(e) => patch({ warrantyMonths: e.target.value })} aria-invalid={!!fe("warrantyMonths")} />
        </Field>
        <Field id="p-country" label="Menşe ülke" error={fe("countryOfOrigin")} hint="ISO kodu (TR, DE, CN…)">
          <input id="p-country" className={`${inputCls} uppercase`} value={form.countryOfOrigin} maxLength={2} onChange={(e) => patch({ countryOfOrigin: e.target.value.toUpperCase() })} aria-invalid={!!fe("countryOfOrigin")} />
        </Field>
        <Field id="p-acc" label="Muhasebe kodu" error={fe("accountingCode")}>
          <input id="p-acc" className={inputCls} value={form.accountingCode} maxLength={64} onChange={(e) => patch({ accountingCode: e.target.value })} />
        </Field>
        <Field id="p-mfr" label="Üretici kodu" error={fe("manufacturerCode")}>
          <input id="p-mfr" className={inputCls} value={form.manufacturerCode} maxLength={64} onChange={(e) => patch({ manufacturerCode: e.target.value })} />
        </Field>
      </div>
    </SectionShell>
  );
}

// --- Marka & Kategori -------------------------------------------------------
function RelationsSection({ form, patch, fe, meta }: SectionProps & { meta: ProductMeta }) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLocaleLowerCase("tr-TR");
  const visible = meta.categories.filter((c) => !q || c.path.toLocaleLowerCase("tr-TR").includes(q));
  const selected = new Map(form.categories.map((c) => [c.id, c.primary]));
  const primary = form.categories.find((c) => c.primary)?.id ?? form.categories[0]?.id ?? null;
  const catErr = fe("categories");

  const toggle = (id: string) => {
    if (selected.has(id)) {
      const rest = form.categories.filter((c) => c.id !== id);
      if (rest.length && !rest.some((c) => c.primary)) rest[0] = { ...rest[0]!, primary: true };
      patch({ categories: rest });
    } else {
      patch({ categories: [...form.categories, { id, primary: form.categories.length === 0 }] });
    }
  };
  const makePrimary = (id: string) => patch({ categories: form.categories.map((c) => ({ ...c, primary: c.id === id })) });

  return (
    <SectionShell title="Marka & Kategori" desc="Ürün birden çok kategoride listelenebilir; birincil kategori sayfa yolunu belirler ve zorunlu özellikleri getirir.">
      <Field id="p-brand" label="Marka" error={fe("brandId")} className="max-w-md">
        <select id="p-brand" className={inputCls} value={form.brandId} onChange={(e) => patch({ brandId: e.target.value })}>
          <option value="">(Markasız)</option>
          {meta.brands.map((b) => <option key={b.id} value={b.id}>{b.name}{b.isActive ? "" : " (pasif)"}</option>)}
        </select>
      </Field>

      <div className="space-y-2" data-invalid={!!catErr}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={labelCls}>Kategoriler<Req /> <span className="font-normal text-slate-400">· {form.categories.length} seçili</span></span>
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Kategori ara</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Kategori ara" className="input h-9 border-slate-200 pl-9 text-sm" />
          </label>
        </div>
        <ul className={`max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-xl border ${catErr ? "border-red-300 ring-2 ring-red-100" : "border-slate-200"}`}>
          {visible.length === 0 ? <li className="px-4 py-6 text-center text-sm text-slate-500">Eşleşen kategori yok.</li> : visible.map((c) => {
            const on = selected.has(c.id);
            const isPrimary = on && c.id === primary;
            return (
              <li key={c.id} className={`flex min-h-11 items-center gap-3 px-3 transition-colors ${on ? "bg-indigo-50/50" : "hover:bg-slate-50"}`} style={{ paddingLeft: q ? undefined : `${12 + c.depth * 18}px` }}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2">
                  <input type="checkbox" className="size-4 flex-none accent-[#7367f0]" checked={on} onChange={() => toggle(c.id)} />
                  <span className={`truncate text-sm ${c.isActive ? "text-slate-800" : "text-slate-400"}`}>{q ? c.path : c.name}</span>
                  {!c.isActive ? <AdminBadge tone="slate">Pasif</AdminBadge> : null}
                </label>
                {on ? (
                  <button type="button" onClick={() => makePrimary(c.id)} aria-pressed={isPrimary}
                    className={`inline-flex flex-none items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition ${isPrimary ? "bg-[#7367f0] text-white" : "border border-slate-200 bg-white text-slate-500 hover:border-[#7367f0]/50 hover:text-[#7367f0]"}`}>
                    {isPrimary ? <Check className="h-3 w-3" /> : null} {isPrimary ? "Birincil" : "Birincil yap"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {catErr ? <p className="flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3 w-3" />{catErr}</p> : null}
      </div>
    </SectionShell>
  );
}

// --- Varyant, fiyat & stok --------------------------------------------------
function VariantsSection({ form, setForm, fe, axisAttrs }: { form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>>; fe: (k: string) => string | undefined; axisAttrs: AttributeMeta[] }) {
  const lockedCount = form.variants.filter((v) => v.locked).length;
  const setVariant = (key: string, p: Partial<VariantState>) => setForm((f) => ({ ...f, variants: f.variants.map((v) => (v.key === key ? { ...v, ...p } : v)) }));
  const setDefault = (key: string) => setForm((f) => ({ ...f, variants: f.variants.map((v) => ({ ...v, isDefault: v.key === key })) }));
  const removeVariant = (key: string) => setForm((f) => {
    const rest = f.variants.filter((v) => v.key !== key);
    if (rest.length && !rest.some((v) => v.isDefault)) rest[0] = { ...rest[0]!, isDefault: true };
    return { ...f, variants: rest };
  });
  const toggleAxis = (id: string) => setForm((f) => ({ ...f, axes: f.axes.includes(id) ? f.axes.filter((a) => a !== id) : [...f.axes, id] }));

  const generate = () => setForm((f) => {
    const axes = axisAttrs.filter((a) => f.axes.includes(a.id));
    let combos: Record<string, string>[] = [{}];
    for (const a of axes) combos = combos.flatMap((c) => a.options.map((o) => ({ ...c, [a.id]: o.id })));
    const has = (c: Record<string, string>) => f.variants.some((v) => axes.every((a) => v.options[a.id] === c[a.id]));
    const added = combos.filter((c) => !has(c)).map((c) => emptyVariant(false, c));
    if (!added.length) notify.info("Tüm kombinasyonlar zaten var.");
    else notify.success(`${added.length} varyant eklendi`, { description: "SKU ve fiyatlarını doldurun." });
    const kept = f.variants.filter((v) => v.sku || v.id || axes.every((a) => v.options[a.id]));
    const all = [...kept, ...added];
    if (all.length && !all.some((v) => v.isDefault)) all[0] = { ...all[0]!, isDefault: true };
    return { ...f, variants: all };
  });

  return (
    <SectionShell title="Varyant, Fiyat & Stok" desc="Her satılabilir SKU. Fiyatlar KDV dahil TL, stok Ana Depo içindir; stok değişiklikleri hareket defterine yazılır."
      actions={
        <div className="flex flex-wrap gap-2">
          {form.axes.length ? (
            <button type="button" onClick={generate} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 transition hover:bg-slate-50">
              <Wand2 className="h-4 w-4" /> Kombinasyonları oluştur
            </button>
          ) : null}
          <button type="button" onClick={() => setForm((f) => ({ ...f, variants: [...f.variants, emptyVariant(f.variants.length === 0)] }))}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#7367f0] px-3 text-sm font-medium text-white transition hover:bg-[#6559df]">
            <Plus className="h-4 w-4" /> Varyant ekle
          </button>
        </div>
      }>
      <div className={`rounded-xl border p-4 ${fe("axes") ? "border-red-300 ring-2 ring-red-100" : "border-slate-200"}`} data-invalid={!!fe("axes")}>
        <p className={labelCls}>Varyant eksenleri</p>
        <div className="flex flex-wrap gap-2">
          {axisAttrs.map((a) => {
            const on = form.axes.includes(a.id);
            return (
              <button key={a.id} type="button" onClick={() => toggleAxis(a.id)} aria-pressed={on}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition ${on ? "border-[#7367f0] bg-indigo-50 font-medium text-[#5b4fe0]" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                {on ? <Check className="h-3.5 w-3.5" /> : null}{a.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">{form.axes.length ? "Her varyant seçili eksenlerin her biri için bir değer almalı." : "Eksen seçilmezse ürün tek varyantlı (basit ürün) olur."}</p>
        {lockedCount ? <p className="mt-1 text-xs text-amber-700">{lockedCount} varyantın sipariş/stok geçmişi var: SKU ve kombinasyonları değiştirilemez, kaldırılırsa pasife alınır.</p> : null}
        {fe("axes") ? <p className="mt-1 flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3 w-3" />{fe("axes")}</p> : null}
      </div>

      <ul className="space-y-3">
        {form.variants.map((v, i) => (
          <VariantCard key={v.key} v={v} index={i} axes={axisAttrs.filter((a) => form.axes.includes(a.id))} fe={fe}
            onChange={(p) => setVariant(v.key, p)} onDefault={() => setDefault(v.key)} onRemove={form.variants.length > 1 ? () => removeVariant(v.key) : undefined} />
        ))}
      </ul>
    </SectionShell>
  );
}

function VariantCard({ v, index, axes, fe, onChange, onDefault, onRemove }: {
  v: VariantState; index: number; axes: AttributeMeta[]; fe: (k: string) => string | undefined;
  onChange: (p: Partial<VariantState>) => void; onDefault: () => void; onRemove?: () => void;
}) {
  const k = (f: string) => `variants.${index}.${f}`;
  const id = (f: string) => `v-${v.key}-${f}`;
  const dimsHaveError = (["weightGrams", "widthMm", "heightMm", "depthMm"] as const).some((f) => fe(k(f)));
  const [dimsOpen, setDimsOpen] = useState(false);
  const price = strToMinor(v.price);
  const compare = strToMinor(v.compareAt);
  const discount = price != null && compare != null && !Number.isNaN(price) && !Number.isNaN(compare) && compare > price ? Math.round(100 - (price / compare) * 100) : 0;
  const label = axes.map((a) => a.options.find((o) => o.id === v.options[a.id])?.label).filter(Boolean).join(" / ") || v.name || `Varyant ${index + 1}`;

  return (
    <li className={`animate-scale-in rounded-xl border bg-white transition ${v.isActive ? "border-slate-200" : "border-dashed border-slate-300 bg-slate-50/60"}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <span className="grid size-6 flex-none place-items-center rounded-md bg-slate-100 text-[11px] font-bold text-slate-500">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{label}</span>
        {v.locked ? <span title="Sipariş/stok geçmişi var"><AdminBadge tone="amber">Geçmişi var</AdminBadge></span> : null}
        {!v.isActive ? <AdminBadge tone="slate">Pasif</AdminBadge> : null}
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${v.isDefault ? "bg-[#7367f0] text-white" : "border border-slate-200 text-slate-500 hover:text-[#7367f0]"}`}>
          <input type="radio" className="sr-only" checked={v.isDefault} onChange={onDefault} name="default-variant" />
          {v.isDefault ? <Sparkles className="h-3 w-3" /> : null} {v.isDefault ? "Varsayılan" : "Varsayılan yap"}
        </label>
        {onRemove ? (
          <button type="button" onClick={onRemove} aria-label={`${index + 1}. varyantı kaldır`} title={v.locked ? "Kaldırılırsa pasife alınır" : "Varyantı kaldır"}
            className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        ) : null}
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {axes.map((a) => {
          const err = fe(k(`options.${a.id}`)) ?? fe(k("options"));
          return (
            <Field key={a.id} id={id(a.id)} label={a.label} required error={err}>
              <select id={id(a.id)} className={inputCls} value={v.options[a.id] ?? ""} disabled={v.locked} aria-invalid={!!err} onChange={(e) => onChange({ options: { ...v.options, [a.id]: e.target.value } })}>
                <option value="">Seçin</option>
                {a.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </Field>
          );
        })}
        <Field id={id("sku")} label="SKU" required error={fe(k("sku"))}>
          <input id={id("sku")} className={`${inputCls} font-mono uppercase`} value={v.sku} maxLength={64} disabled={v.locked} aria-invalid={!!fe(k("sku"))} onChange={(e) => onChange({ sku: e.target.value.toUpperCase() })} />
        </Field>
        <Field id={id("barcode")} label="Barkod (GTIN)" error={fe(k("barcode"))}>
          <input id={id("barcode")} className={`${inputCls} font-mono`} value={v.barcode} maxLength={32} inputMode="numeric" aria-invalid={!!fe(k("barcode"))} onChange={(e) => onChange({ barcode: e.target.value })} />
        </Field>
        <Field id={id("price")} label="Satış fiyatı (₺)" required error={fe(k("priceMinor"))}>
          <input id={id("price")} className={`${inputCls} tabular-nums`} value={v.price} inputMode="decimal" placeholder="0,00" aria-invalid={!!fe(k("priceMinor"))} onChange={(e) => onChange({ price: e.target.value })}
            onBlur={() => { const m = strToMinor(v.price); if (m != null && !Number.isNaN(m)) onChange({ price: minorToStr(m) }); }} />
        </Field>
        <Field id={id("compare")} label="Eski fiyat (₺)" error={fe(k("compareAtMinor"))} hint={discount > 0 ? <span className="text-emerald-600">%{discount} indirim gösterilir</span> : undefined}>
          <input id={id("compare")} className={`${inputCls} tabular-nums`} value={v.compareAt} inputMode="decimal" placeholder="—" aria-invalid={!!fe(k("compareAtMinor"))} onChange={(e) => onChange({ compareAt: e.target.value })}
            onBlur={() => { const m = strToMinor(v.compareAt); if (m != null && !Number.isNaN(m)) onChange({ compareAt: minorToStr(m) }); }} />
        </Field>
        <Field id={id("stock")} label="Stok (eldeki)" required error={fe(k("stock"))} hint={v.reserved ? `${v.reserved} adet rezerve · satılabilir ${Math.max(0, (strToInt(v.stock) || 0) - v.reserved)}` : undefined}>
          <input id={id("stock")} inputMode="numeric" className={`${inputCls} tabular-nums`} value={v.stock} aria-invalid={!!fe(k("stock"))} onChange={(e) => onChange({ stock: e.target.value })} />
        </Field>
        <Field id={id("name")} label="Varyant adı" error={fe(k("name"))}>
          <input id={id("name")} className={inputCls} value={v.name} maxLength={120} placeholder="İsteğe bağlı" onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <label className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] border border-slate-200 px-3">
            <span className="text-sm text-slate-700">Satışta</span>
            <input type="checkbox" className="size-4 accent-[#7367f0]" checked={v.isActive} onChange={(e) => onChange({ isActive: e.target.checked })} />
          </label>
        </div>
      </div>
      <div className="border-t border-slate-100 px-4 py-2">
        <button type="button" onClick={() => setDimsOpen((o) => !o)} aria-expanded={dimsOpen || dimsHaveError} className={`text-xs font-medium ${dimsHaveError ? "text-red-600" : "text-slate-500 hover:text-slate-800"}`}>
          {dimsOpen || dimsHaveError ? "Ölçüleri gizle" : "Ağırlık ve ölçüler"} {price != null && !Number.isNaN(price) ? <span className="ml-2 font-normal text-slate-400">· {formatMinor(price)}</span> : null}
        </button>
        <Collapsible open={dimsOpen || dimsHaveError}>
          <div className="grid grid-cols-2 gap-3 pb-2 pt-3 sm:grid-cols-4">
            {([["weightGrams", "Ağırlık (g)"], ["widthMm", "En (mm)"], ["heightMm", "Boy (mm)"], ["depthMm", "Derinlik (mm)"]] as const).map(([f, l]) => (
              <Field key={f} id={id(f)} label={l} error={fe(k(f))}>
                <input id={id(f)} inputMode="numeric" className={inputCls} value={v[f]} aria-invalid={!!fe(k(f))} onChange={(e) => onChange({ [f]: e.target.value })} />
              </Field>
            ))}
          </div>
        </Collapsible>
      </div>
    </li>
  );
}

// --- Özellikler -------------------------------------------------------------
function AttributesSection({ form, patch, fe, meta }: SectionProps & { meta: ProductMeta }) {
  const required = requiredAttributeIds(meta, form.categories.map((c) => c.id));
  const attributes = meta.attributes
    .filter((a) => !form.axes.includes(a.id))
    .sort((a, b) => Number(required.has(b.id)) - Number(required.has(a.id)));
  const set = (id: string, values: (string | number | boolean)[]) => patch({ attributes: { ...form.attributes, [id]: values } });
  return (
    <SectionShell title="Özellikler" desc="Ürün detayında “Ürün özellikleri” tablosunda ve filtrelerde kullanılır. Seçtiğiniz kategorinin zorunlu kıldığı özellikler en üstte.">
      {attributes.length === 0 ? <p className="text-sm text-slate-500">Tanımlı özellik yok.</p> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {attributes.map((a) => {
            const vals = form.attributes[a.id] ?? [];
            const fid = `attr-${a.id}`;
            const err = fe(`attributes.${a.id}`);
            const req = required.has(a.id);
            const label = `${a.label}${a.unit ? ` (${a.unit})` : ""}`;
            if (a.dataType === "multiselect" || (a.dataType === "select" && a.options.length <= 8)) {
              const multi = a.dataType === "multiselect";
              return (
                <fieldset key={a.id} className="sm:col-span-2" data-invalid={!!err}>
                  <legend className={labelCls}>{label}{req ? <Req /> : null}{multi ? <span className="font-normal text-slate-400"> · çoklu seçim</span> : null}</legend>
                  <div className={`flex flex-wrap gap-2 rounded-xl ${err ? "p-2 ring-2 ring-red-100" : ""}`}>
                    {a.options.map((o) => {
                      const on = vals.includes(o.id);
                      return (
                        <button key={o.id} type="button" aria-pressed={on}
                          onClick={() => set(a.id, multi ? (on ? vals.filter((x) => x !== o.id) : [...vals, o.id]) : on ? [] : [o.id])}
                          className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm transition ${on ? "border-[#7367f0] bg-indigo-50 font-medium text-[#5b4fe0]" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                          {o.colorHex ? <span className="size-3.5 rounded-full border border-slate-200" style={{ background: o.colorHex }} aria-hidden /> : null}{o.label}
                        </button>
                      );
                    })}
                  </div>
                  {err ? <p className="mt-1 flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3 w-3" />{err}</p> : req ? <p className="mt-1 text-xs text-slate-500">Bu kategori için zorunlu.</p> : null}
                </fieldset>
              );
            }
            return (
              <Field key={a.id} id={fid} label={label} required={req} error={err} hint={req ? "Bu kategori için zorunlu." : undefined}>
                {a.dataType === "boolean" ? (
                  <select id={fid} className={inputCls} aria-invalid={!!err} value={vals[0] === undefined ? "" : String(vals[0])} onChange={(e) => set(a.id, e.target.value === "" ? [] : [e.target.value === "true"])}>
                    <option value="">—</option><option value="true">Evet</option><option value="false">Hayır</option>
                  </select>
                ) : a.dataType === "select" ? (
                  <select id={fid} className={inputCls} aria-invalid={!!err} value={String(vals[0] ?? "")} onChange={(e) => set(a.id, e.target.value ? [e.target.value] : [])}>
                    <option value="">—</option>{a.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                ) : (
                  <input id={fid} className={inputCls} aria-invalid={!!err} inputMode={a.dataType === "number" ? "decimal" : undefined} value={String(vals[0] ?? "")}
                    onChange={(e) => set(a.id, e.target.value === "" ? [] : [e.target.value])} />
                )}
              </Field>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}

// --- SEO --------------------------------------------------------------------
function SeoSection({ form, patch, fe }: SectionProps) {
  const seo = form.seo;
  const set = (p: Partial<FormState["seo"]>) => patch({ seo: { ...seo, ...p } });
  const title = seo.metaTitle || form.name || "Ürün adı";
  const desc = seo.metaDescription || form.shortDescription || "Açıklama girilmezse kısa açıklama kullanılır.";
  return (
    <SectionShell title="SEO" desc="Arama motorları ve sosyal paylaşımlarda görünüm. Boş bırakılan alanlar ürün bilgilerinden üretilir.">
      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,22rem)]">
        <div className="space-y-4">
          <Field id="seo-title" label="Meta başlık" error={fe("seo.metaTitle")} hint={<Counter value={seo.metaTitle} max={120} />}>
            <input id="seo-title" className={inputCls} value={seo.metaTitle} maxLength={120} placeholder={form.name} aria-invalid={!!fe("seo.metaTitle")} onChange={(e) => set({ metaTitle: e.target.value })} />
          </Field>
          <Field id="seo-desc" label="Meta açıklama" error={fe("seo.metaDescription")} hint={<Counter value={seo.metaDescription} max={320} />}>
            <textarea id="seo-desc" className={`${inputCls} min-h-24 py-2`} value={seo.metaDescription} maxLength={320} aria-invalid={!!fe("seo.metaDescription")} onChange={(e) => set({ metaDescription: e.target.value })} />
          </Field>
          <Field id="seo-canonical" label="Canonical adres" error={fe("seo.canonicalUrl")} hint="Boşsa ürünün kendi adresi kullanılır.">
            <input id="seo-canonical" className={inputCls} value={seo.canonicalUrl} maxLength={500} placeholder="/urun/…" aria-invalid={!!fe("seo.canonicalUrl")} onChange={(e) => set({ canonicalUrl: e.target.value })} />
          </Field>
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
            <span><span className="block text-sm font-medium text-slate-800">Arama motorlarında gösterme (noindex)</span><span className="block text-xs text-slate-500">Ürün sitede görünür ama Google’a eklenmez.</span></span>
            <input type="checkbox" className="size-5 flex-none accent-[#7367f0]" checked={seo.noindex} onChange={(e) => set({ noindex: e.target.checked })} />
          </label>
        </div>
        <div className="space-y-2">
          <p className={labelCls}>Önizleme</p>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="truncate text-xs text-slate-500">nova · /urun/{slugify(form.slug.trim() || form.name) || "…"}</p>
            <p className="mt-1 line-clamp-2 text-lg leading-snug text-[#1a0dab]">{title} | nova.</p>
            <p className="mt-1 line-clamp-3 text-sm text-slate-600">{desc}</p>
            {seo.noindex ? <p className="mt-2"><AdminBadge tone="amber">noindex</AdminBadge></p> : null}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
