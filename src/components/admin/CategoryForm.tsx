"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, ClientApiError } from "@/lib/api-client";
import { slugify } from "@/lib/slug";
import { notify } from "@/lib/toast";
import type { CategoryNode } from "@/modules/catalog";
import { ImageUpload, type UploadedImage } from "./ImageUpload";

export type ParentOption = { id: string; name: string; depth: number };

type FormState = {
  name: string;
  slug: string;
  parentId: string;
  description: string;
  image: UploadedImage | null;
  menuImage: UploadedImage | null;
  sortOrder: string;
  isActive: boolean;
};

const media = (id: string | null | undefined, url: string | null | undefined): UploadedImage | null => (id && url ? { id, url } : null);

const fromNode = (n?: CategoryNode | null, parentId?: string | null): FormState => ({
  name: n?.name ?? "",
  slug: n?.slug ?? "",
  parentId: n ? n.parentId ?? "" : parentId ?? "",
  description: n?.description ?? "",
  image: media(n?.imageMediaId, n?.imageUrl),
  menuImage: media(n?.menuMediaId, n?.menuUrl),
  sortOrder: String(n?.sortOrder ?? 0),
  isActive: n?.isActive ?? true,
});

const labelCls = "mb-1 block text-xs font-medium text-slate-600";
const inputCls = "input border-slate-200 text-sm text-slate-800";

/**
 * Create / edit form covering every column of `categories`
 * (name, slug, parent_id, description, image_media_id, menu_media_id, sort_order, is_active).
 * Images are uploaded from the user's computer; only their media id is saved on the category.
 */
export function CategoryForm({
  formId,
  mode,
  category,
  defaultParentId,
  parents,
  onSaved,
  onBusyChange,
  renderActions,
}: {
  formId: string;
  mode: "create" | "edit";
  category?: CategoryNode | null;
  defaultParentId?: string | null;
  parents: ParentOption[];
  onSaved: (id: string) => void;
  onBusyChange?: (busy: boolean) => void;
  renderActions?: (busy: boolean) => ReactNode;
}) {
  // Form state is seeded once; callers remount with `key` to load a different category.
  const [form, setForm] = useState<FormState>(() => fromNode(category, defaultParentId));
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState({ image: false, menu: false });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const busy = saving || uploads.image || uploads.menu;
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  const patch = (p: Partial<FormState>) => setForm((s) => ({ ...s, ...p }));
  const fe = (k: string) => fieldErrors[k]?.[0];
  const slugPreview = form.slug.trim() ? slugify(form.slug) : slugify(form.name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setSaving(true);
    setFieldErrors({});
    const sortOrder = Number.parseInt(form.sortOrder, 10);
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim() || undefined,
      parentId: form.parentId || null,
      description: form.description.trim() || null,
      imageMediaId: form.image?.id ?? null,
      menuMediaId: form.menuImage?.id ?? null,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
      isActive: form.isActive,
    };
    try {
      if (mode === "create") {
        const r = await api<{ id: string }>("/api/admin/categories", { method: "POST", json: payload });
        onSaved(r.data.id);
      } else if (category) {
        await api(`/api/admin/categories/${encodeURIComponent(category.id)}`, { method: "PUT", json: payload });
        onSaved(category.id);
      }
    } catch (err) {
      if (err instanceof ClientApiError) setFieldErrors(err.fieldErrors);
      const fields = err instanceof ClientApiError ? Object.keys(err.fieldErrors).length : 0;
      notify.error(err, { description: fields ? "İşaretli alanları kontrol edin." : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form id={formId} onSubmit={submit} noValidate className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${formId}-name`} className={labelCls}>Kategori adı *</label>
          <input id={`${formId}-name`} className={inputCls} value={form.name} maxLength={160} required
            aria-invalid={!!fe("name")} onChange={(e) => patch({ name: e.target.value })} />
          <FieldError msg={fe("name")} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={`${formId}-slug`} className={labelCls}>Slug (URL)</label>
          <input id={`${formId}-slug`} className={inputCls} value={form.slug} maxLength={160} placeholder={slugify(form.name) || "otomatik-uretilir"}
            aria-invalid={!!fe("slug")} aria-describedby={`${formId}-slug-hint`} onChange={(e) => patch({ slug: e.target.value })} />
          <p id={`${formId}-slug-hint`} className="mt-1 break-all text-xs text-slate-500">
            {slugPreview ? <>Adres: <span className="font-mono text-slate-700">/kategori/{slugPreview}</span></> : "Boş bırakılırsa addan üretilir."}
          </p>
          <FieldError msg={fe("slug")} />
        </div>

        <div>
          <label htmlFor={`${formId}-parent`} className={labelCls}>Üst kategori</label>
          <select id={`${formId}-parent`} className={inputCls} value={form.parentId} aria-invalid={!!fe("parentId")}
            onChange={(e) => patch({ parentId: e.target.value })}>
            <option value="">(Kök kategori)</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>{"— ".repeat(p.depth)}{p.name}</option>
            ))}
          </select>
          <FieldError msg={fe("parentId")} />
        </div>

        <div>
          <label htmlFor={`${formId}-sort`} className={labelCls}>Sıra</label>
          <input id={`${formId}-sort`} type="number" inputMode="numeric" step={1} className={inputCls} value={form.sortOrder}
            aria-invalid={!!fe("sortOrder")} onChange={(e) => patch({ sortOrder: e.target.value })} />
          <FieldError msg={fe("sortOrder")} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={`${formId}-desc`} className={labelCls}>Açıklama</label>
          <textarea id={`${formId}-desc`} className={`${inputCls} min-h-24 py-2`} value={form.description} maxLength={1000}
            aria-invalid={!!fe("description")} onChange={(e) => patch({ description: e.target.value })} />
          <p className="mt-1 text-right text-xs text-slate-400">{form.description.length}/1000</p>
          <FieldError msg={fe("description")} />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <ImageUpload label="Kategori görseli" hint="Kategori sayfası ve vitrin kartlarında." folder="categories"
          value={form.image} onChange={(v) => patch({ image: v })} error={fe("imageMediaId")}
          onUploadingChange={(u) => setUploads((s) => ({ ...s, image: u }))} />
        <ImageUpload label="Menü görseli" hint="Mega menüde kategori yanında." folder="categories"
          value={form.menuImage} onChange={(v) => patch({ menuImage: v })} error={fe("menuMediaId")}
          onUploadingChange={(u) => setUploads((s) => ({ ...s, menu: u }))} />
      </div>

      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
        <span>
          <span className="block text-sm font-medium text-slate-800">Aktif</span>
          <span className="block text-xs text-slate-500">Pasif kategoriler vitrinde ve menüde görünmez.</span>
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
