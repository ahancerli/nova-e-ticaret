"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, Play, Star, Trash2 } from "lucide-react";
import { uploadImage } from "./api";
import { notify } from "@/lib/toast";

export type GalleryItem = { mediaId: string; url: string; kind?: "image" | "video" };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const VIDEO_TYPE = "video/mp4";
const MAX_BYTES = 5 * 1024 * 1024;

type Pending = { key: string; preview: string; progress: number; video: boolean };

/** First frame as the tile picture: `#t=` makes the browser seek there once metadata is loaded. */
const frameOf = (url: string) => `${url}#t=0.1`;

/**
 * Ordered multi-image gallery: upload from the computer (multi-select or drag & drop),
 * reorder, choose the primary (storefront cover) image, remove. Files go to media storage via /api/admin/media.
 * `allowVideo`: short MP4 clips sit in the same order as the images; a video is never the cover.
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
  allowVideo = false,
}: {
  folder: "products";
  items: GalleryItem[];
  primaryId: string | null;
  onChange: (items: GalleryItem[], primaryId: string | null) => void;
  onUploadingChange?: (uploading: boolean) => void;
  error?: string;
  max?: number;
  compact?: boolean;
  allowVideo?: boolean;
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

  const accept = allowVideo ? [...IMAGE_TYPES, VIDEO_TYPE] : IMAGE_TYPES;
  const noun = allowVideo ? "görsel veya video" : "görsel";
  const images = items.filter((i) => i.kind !== "video");
  const effectivePrimary = primaryId && images.some((i) => i.mediaId === primaryId) ? primaryId : images[0]?.mediaId ?? null;

  const upload = async (file: File) => {
    const video = file.type === VIDEO_TYPE;
    if (!accept.includes(file.type)) {
      return void notify.error(allowVideo ? "Sadece JPG, PNG, WebP, AVIF görsel veya MP4 video yükleyebilirsiniz." : "Sadece JPG, PNG, WebP veya AVIF yükleyebilirsiniz.", { description: file.name });
    }
    if (file.size > MAX_BYTES) {
      return void notify.error(`${video ? "Video" : "Görsel"} en fazla 5 MB olabilir.`, { description: video ? `${file.name}: videoyu kısaltın veya 720p olarak dışa aktarın.` : file.name });
    }
    const key = crypto.randomUUID();
    const preview = URL.createObjectURL(file);
    setPending((p) => [...p, { key, preview, progress: 0, video }]);
    try {
      const r = await uploadImage(file, folder, {
        onProgress: (v) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress: v } : x))),
      });
      const { items: cur, primaryId: prim } = latest.current;
      const isVideo = r.data.mime.startsWith("video/");
      const next = [...cur, { mediaId: r.data.id, url: r.data.url, kind: isVideo ? "video" as const : "image" as const }];
      const nextPrimary = prim ?? (isVideo ? null : r.data.id);
      latest.current = { items: next, primaryId: nextPrimary };
      onChange(next, nextPrimary);
    } catch (err) {
      notify.error(err, { fallback: `${video ? "Video" : "Görsel"} yüklenemedi.`, description: file.name });
    } finally {
      URL.revokeObjectURL(preview);
      setPending((p) => p.filter((x) => x.key !== key));
    }
  };

  const addFiles = (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (items.length + pending.length + list.length > max) notify.warning(`Buraya en fazla ${max} ${noun} eklenebilir.`);
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
    onChange(next, effectivePrimary === id ? next.find((i) => i.kind !== "video")?.mediaId ?? null : effectivePrimary);
  };

  return (
    <div className="space-y-3">
      <input ref={inputRef} type="file" multiple accept={accept.join(",")} className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <ul className={compact ? "grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-8" : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"}>
        {items.map((it, i) => {
          const primary = !compact && it.mediaId === effectivePrimary;
          const video = it.kind === "video";
          return (
            <li key={it.mediaId} className={`group relative animate-scale-in overflow-hidden rounded-xl border-2 bg-slate-50 ${primary ? "border-[#7367f0]" : "border-slate-200"}`}>
              {video ? (
                <>
                  <video src={frameOf(it.url)} muted playsInline preload="metadata" className="aspect-square w-full bg-slate-900 object-cover" />
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-slate-900/80 px-2 py-0.5 text-[11px] font-semibold text-white"><Play className="size-3 fill-current" />Video</span>
                </>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.url} alt="" className="aspect-square w-full object-cover" />
              )}
              {primary ? <span className="absolute left-2 top-2 rounded-md bg-[#7367f0] px-2 py-0.5 text-[11px] font-semibold text-white shadow">Vitrin</span> : null}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-slate-900/70 to-transparent p-2 opacity-100 transition sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <span className="flex gap-1">
                  <IconBtn label="Sola taşı" disabled={i === 0} onClick={() => move(i, -1)}><ChevronLeft className="h-4 w-4" /></IconBtn>
                  <IconBtn label="Sağa taşı" disabled={i === items.length - 1} onClick={() => move(i, 1)}><ChevronRight className="h-4 w-4" /></IconBtn>
                </span>
                <span className="flex gap-1">
                  {compact || video ? null : <IconBtn label="Vitrin görseli yap" pressed={primary} onClick={() => onChange(items, it.mediaId)}><Star className={`h-4 w-4 ${primary ? "fill-current" : ""}`} /></IconBtn>}
                  <IconBtn label={video ? "Videoyu kaldır" : "Görseli kaldır"} danger onClick={() => remove(it.mediaId)}><Trash2 className="h-4 w-4" /></IconBtn>
                </span>
              </div>
            </li>
          );
        })}
        {pending.map((p) => (
          <li key={p.key} className="relative overflow-hidden rounded-xl border-2 border-dashed border-[#7367f0]/50 bg-slate-50" aria-live="polite">
            {p.video ? <video src={p.preview} muted playsInline preload="metadata" className="aspect-square w-full object-cover opacity-60" /> : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.preview} alt="" className="aspect-square w-full object-cover opacity-60 blur-[1px]" />
            )}
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
            <span className="text-xs text-slate-600">{dragging ? "Bırakın" : compact ? "Ekle" : <>{allowVideo ? "Görsel veya video ekle" : "Görsel ekle"}<br /><span className="text-slate-400">sürükle veya seç</span></>}</span>
          </button>
        </li>
      </ul>
      {compact ? null : <p className="text-xs text-slate-500">{allowVideo ? `Görsel: JPG, PNG, WebP, AVIF. Video: MP4. Dosya başına en fazla 5 MB, toplam ${max} adet (${items.length} eklendi). ` : `JPG, PNG, WebP, AVIF, en fazla 5 MB, ${max} görsel. `}Yıldızlı görsel vitrinde ve listelerde kullanılır{allowVideo ? "; yakınlaştırma için en az 1600 piksel genişlikte görsel yükleyin." : "."}</p>}
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
