"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useFieldErrors } from "@/lib/use-field-errors";
import { brandsApi } from "./api";
import { slugify } from "@/lib/slug";
import { notify } from "@/lib/toast";
import type { BrandRow } from "@/modules/catalog";
import { ImageUpload, type UploadedImage } from "@/features/media/ImageUpload";

type FormState = {
  name: string;
  slug: string;
  description: string;
  websiteUrl: string;
  logo: UploadedImage | null;
  banner: UploadedImage | null;
  isActive: boolean;
};

const media = (id: string | null | undefined, url: string | null | undefined): UploadedImage | null => (id && url ? { id, url } : null);

const fromBrand = (b?: BrandRow | null): FormState => ({
  name: b?.name ?? "",
  slug: b?.slug ?? "",
  description: b?.description ?? "",
  websiteUrl: b?.websiteUrl ?? "",
  logo: media(b?.logoMediaId, b?.logoUrl),
  banner: media(b?.bannerMediaId, b?.bannerUrl),
  isActive: b?.isActive ?? true,
});

const labelCls = "mb-1 block text-xs font-medium text-slate-600";
const inputCls = "input border-slate-200 text-sm text-slate-800";

/**
 * Create / edit form covering every editable column of `brands`
 * (name, slug, description, logo_media_id, banner_media_id, website_url, is_active).
 */
export function BrandForm({
  formId,
  mode,
  brand,
  onSaved,
  onBusyChange,
  renderActions,
}: {
  formId: string;
  mode: "create" | "edit";
  brand?: BrandRow | null;
  onSaved: (id: string) => void;
  onBusyChange?: (busy: boolean) => void;
  renderActions?: (busy: boolean) => ReactNode;
}) {
  // Seeded once; callers remount with `key` to load another brand.
  const [form, setForm] = useState<FormState>(() => fromBrand(brand));
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState({ logo: false, banner: false });
  const errors = useFieldErrors();

  const busy = saving || uploads.logo || uploads.banner;
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  const patch = (p: Partial<FormState>) => setForm((s) => ({ ...s, ...p }));
  const fe = errors.get;
  const slugPreview = form.slug.trim() ? slugify(form.slug) : slugify(form.name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setSaving(true);
    errors.clear();
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim() || undefined,
      description: form.description.trim() || null,
      websiteUrl: form.websiteUrl.trim() || null,
      logoMediaId: form.logo?.id ?? null,
      bannerMediaId: form.banner?.id ?? null,
      isActive: form.isActive,
    };
    try {
      if (mode === "create") {
        const r = await brandsApi.create(payload);
        onSaved(r.data.id);
      } else if (brand) {
        await brandsApi.update(brand.id, payload);
        onSaved(brand.id);
      }
    } catch (err) {
      const fields = errors.fromError(err);
      notify.error(err, { description: fields ? "İşaretli alanları kontrol edin." : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${formId}-name`} className={labelCls}>Marka adı *</label>
          <input id={`${formId}-name`} className={inputCls} value={form.name} maxLength={160} required
            aria-invalid={!!fe("name")} onChange={(e) => patch({ name: e.target.value })} />
          <FieldError msg={fe("name")} />
        </div>

        <div>
          <label htmlFor={`${formId}-slug`} className={labelCls}>Slug (URL)</label>
          <input id={`${formId}-slug`} className={inputCls} value={form.slug} maxLength={160} placeholder={slugify(form.name) || "otomatik-uretilir"}
            aria-invalid={!!fe("slug")} aria-describedby={`${formId}-slug-hint`} onChange={(e) => patch({ slug: e.target.value })} />
          <p id={`${formId}-slug-hint`} className="mt-1 break-all text-xs text-slate-500">
            {slugPreview ? <>Adres: <span className="font-mono text-slate-700">/marka/{slugPreview}</span></> : "Boş bırakılırsa addan üretilir."}
          </p>
          <FieldError msg={fe("slug")} />
        </div>

        <div>
          <label htmlFor={`${formId}-web`} className={labelCls}>Web sitesi</label>
          <input id={`${formId}-web`} type="url" inputMode="url" className={inputCls} value={form.websiteUrl} maxLength={500} placeholder="https://"
            aria-invalid={!!fe("websiteUrl")} onChange={(e) => patch({ websiteUrl: e.target.value })} />
          <FieldError msg={fe("websiteUrl")} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={`${formId}-desc`} className={labelCls}>Açıklama</label>
          <textarea id={`${formId}-desc`} className={`${inputCls} min-h-24 py-2`} value={form.description} maxLength={2000}
            aria-invalid={!!fe("description")} onChange={(e) => patch({ description: e.target.value })} />
          <p className="mt-1 text-right text-xs text-slate-400">{form.description.length}/2000</p>
          <FieldError msg={fe("description")} />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ImageUpload label="Logo" hint="Kare, şeffaf arka planlı tercih edin." folder="brands" aspect="aspect-square"
          value={form.logo} onChange={(v) => patch({ logo: v })} error={fe("logoMediaId")}
          onUploadingChange={(u) => setUploads((s) => ({ ...s, logo: u }))} />
        <ImageUpload label="Banner" hint="Marka sayfası üst görseli." folder="brands"
          value={form.banner} onChange={(v) => patch({ banner: v })} error={fe("bannerMediaId")}
          onUploadingChange={(u) => setUploads((s) => ({ ...s, banner: u }))} />
      </div>

      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
        <span>
          <span className="block text-sm font-medium text-slate-800">Aktif</span>
          <span className="block text-xs text-slate-500">Pasif markalar vitrinde, marka listesinde ve filtrelerde görünmez.</span>
        </span>
        <input type="checkbox" className="size-5 flex-none accent-[#7367f0]" checked={form.isActive} onChange={(e) => patch({ isActive: e.target.checked })} />
      </label>

      {renderActions ? renderActions(busy) : null}
    </form>
  );
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? <p className="mt-1 text-xs text-red-600">{msg}</p> : null;
}
