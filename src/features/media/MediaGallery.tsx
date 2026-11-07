"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, Star, Trash2 } from "lucide-react";
import { uploadImage } from "./api";
import { notify } from "@/lib/toast";

export type GalleryItem = { mediaId: string; url: string };

const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 5 * 1024 * 1024;

type Pending = { key: string; preview: string; progress: number };

/**
 * Ordered multi-image gallery: upload from the computer (multi-select or drag & drop),
 * reorder, choose the primary (storefront cover) image, remove. Files go to R2 via /api/admin/media.
 * `compact`: small tiles without a cover star (a variant's / colour's own photos, where order alone decides).
 */
export function MediaGallery({
  folder,
  items,
  primaryId,
  onChange,
  onUploadingChange,
  error,
  max = 30,
  compact = false,
}: {
  folder: "products";
  items: GalleryItem[];
  primaryId: string | null;
  onChange: (items: GalleryItem[], primaryId: string | null) => void;
  onUploadingChange?: (uploading: boolean) => void;
  error?: string;
  max?: number;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  // Uploads finish out of order; read the latest list when appending.
  const latest = useRef({ items, primaryId });
  useEffect(() => {
    latest.current = { items, primaryId };
  }, [items, primaryId]);
  useEffect(() => onUploadingChange?.(pending.length > 0), [pending.length, onUploadingChange]);

  const effectivePrimary = primaryId && items.some((i) => i.mediaId === primaryId) ? primaryId : items[0]?.mediaId ?? null;

  const upload = async (file: File) => {
    if (!ACCEPT.includes(file.type)) return void notify.error("Sadece JPG, PNG, WebP veya AVIF yükleyebilirsiniz.", { description: file.name });
    if (file.size > MAX_BYTES) return void notify.error("Görsel en fazla 5 MB olabilir.", { description: file.name });
    const key = crypto.randomUUID();
    const preview = URL.createObjectURL(file);
    setPending((p) => [...p, { key, preview, progress: 0 }]);
    try {
      const r = await uploadImage(file, folder, {
        onProgress: (v) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress: v } : x))),
      });
      const { items: cur, primaryId: prim } = latest.current;
      const next = [...cur, { mediaId: r.data.id, url: r.data.url }];
      latest.current = { items: next, primaryId: prim ?? r.data.id };
      onChange(next, prim ?? r.data.id);
    } catch (err) {
      notify.error(err, { fallback: "Görsel yüklenemedi.", description: file.name });
    } finally {
      URL.revokeObjectURL(preview);
      setPending((p) => p.filter((x) => x.key !== key));
    }
  };

  const addFiles = (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (items.length + pending.length + list.length > max) notify.warning(`Buraya en fazla ${max} görsel eklenebilir.`);
    list.slice(0, Math.max(0, max - items.length - pending.length)).forEach((f) => void upload(f));
  };

  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    onChange(next, effectivePrimary);
  };
  const remove = (id: string) => {
    const next = items.filter((i) => i.mediaId !== id);
    onChange(next, effectivePrimary === id ? next[0]?.mediaId ?? null : effectivePrimary);
  };

  return (
    <div className="space-y-3">
      <input ref={inputRef} type="file" multiple accept={ACCEPT.join(",")} className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <ul className={compact ? "grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-8" : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"}>
        {items.map((it, i) => {
          const primary = !compact && it.mediaId === effectivePrimary;
          return (
            <li key={it.mediaId} className={`group relative animate-scale-in overflow-hidden rounded-xl border-2 bg-slate-50 ${primary ? "border-[#7367f0]" : "border-slate-200"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.url} alt="" className="aspect-square w-full object-cover" />
              {primary ? <span className="absolute left-2 top-2 rounded-md bg-[#7367f0] px-2 py-0.5 text-[11px] font-semibold text-white shadow">Vitrin</span> : null}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-slate-900/70 to-transparent p-2 opacity-100 transition sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <span className="flex gap-1">
                  <IconBtn label="Sola taşı" disabled={i === 0} onClick={() => move(i, -1)}><ChevronLeft className="h-4 w-4" /></IconBtn>
                  <IconBtn label="Sağa taşı" disabled={i === items.length - 1} onClick={() => move(i, 1)}><ChevronRight className="h-4 w-4" /></IconBtn>
                </span>
                <span className="flex gap-1">
                  {compact ? null : <IconBtn label="Vitrin görseli yap" pressed={primary} onClick={() => onChange(items, it.mediaId)}><Star className={`h-4 w-4 ${primary ? "fill-current" : ""}`} /></IconBtn>}
                  <IconBtn label="Görseli kaldır" danger onClick={() => remove(it.mediaId)}><Trash2 className="h-4 w-4" /></IconBtn>
                </span>
              </div>
            </li>
          );
        })}
        {pending.map((p) => (
          <li key={p.key} className="relative overflow-hidden rounded-xl border-2 border-dashed border-[#7367f0]/50 bg-slate-50" aria-live="polite">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.preview} alt="" className="aspect-square w-full object-cover opacity-60 blur-[1px]" />
            <div className="absolute inset-x-3 bottom-3 space-y-1">
              <p className="text-center text-xs font-semibold text-slate-700 tabular-nums">%{Math.round(p.progress * 100)}</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/80"><div className="h-full rounded-full bg-[#7367f0] transition-[width] duration-200" style={{ width: `${Math.max(4, p.progress * 100)}%` }} /></div>
            </div>
          </li>
        ))}
        <li>
          <button type="button" onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
            className={`flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-3 text-center transition duration-200 ${
              dragging ? "scale-[1.02] border-[#7367f0] bg-indigo-50" : "border-slate-300 bg-slate-50/60 hover:border-[#7367f0]/60 hover:bg-indigo-50/40"
            }`}>
            <span className={`grid place-items-center rounded-full bg-white text-[#7367f0] shadow-sm ring-1 ring-slate-200 ${compact ? "size-7" : "size-10"}`}><ImagePlus className={compact ? "h-4 w-4" : "h-5 w-5"} /></span>
            <span className="text-xs text-slate-600">{dragging ? "Bırakın" : compact ? "Ekle" : <>Görsel ekle<br /><span className="text-slate-400">sürükle veya seç</span></>}</span>
          </button>
        </li>
      </ul>
      {compact ? null : <p className="text-xs text-slate-500">JPG, PNG, WebP, AVIF · en fazla 5 MB · {max} görsel. Yıldızlı görsel vitrinde ve listelerde kullanılır.</p>}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, pressed, danger, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick} disabled={disabled}
      className={`grid size-8 place-items-center rounded-lg bg-white/95 shadow-sm transition disabled:opacity-40 ${danger ? "text-red-600 hover:bg-red-50" : pressed ? "text-[#7367f0]" : "text-slate-700 hover:bg-white"}`}>
      {children}
    </button>
  );
}
