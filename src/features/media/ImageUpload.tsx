"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImageUp, RefreshCw, Trash2, X } from "lucide-react";
import { uploadImage, type MediaFolder } from "./api";
import { notify } from "@/lib/toast";

export type UploadedImage = { id: string; url: string };

const ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Image picker that only takes files from the user's computer (click or drag & drop).
 * The file is uploaded immediately to /api/admin/media (R2); the parent receives { id, url }
 * and saves only the media id on its own record.
 */
export function ImageUpload({
  label,
  hint,
  folder,
  aspect = "aspect-[16/9]",
  value,
  onChange,
  onUploadingChange,
  error,
}: {
  label: string;
  hint?: string;
  folder: MediaFolder;
  /** Preview box ratio, e.g. "aspect-square" for logos. */
  aspect?: string;
  value: UploadedImage | null;
  onChange: (v: UploadedImage | null) => void;
  onUploadingChange?: (uploading: boolean) => void;
  error?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [dragging, setDragging] = useState(false);
  const [upload, setUpload] = useState<{ preview: string; progress: number; name: string } | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async (file: File) => {
    if (!ACCEPT.includes(file.type)) return void notify.error("Sadece JPG, PNG, WebP veya AVIF yükleyebilirsiniz.", { description: file.name });
    if (file.size > MAX_BYTES) return void notify.error("Görsel en fazla 5 MB olabilir.", { description: `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const preview = URL.createObjectURL(file);
    setUpload({ preview, progress: 0, name: file.name });
    onUploadingChange?.(true);

    try {
      const r = await uploadImage(file, folder, {
        signal: controller.signal,
        onProgress: (p) => setUpload((u) => (u ? { ...u, progress: p } : u)),
      });
      onChange({ id: r.data.id, url: r.data.url });
    } catch (err) {
      if (!controller.signal.aborted) notify.error(err, { fallback: "Görsel yüklenemedi." });
    } finally {
      URL.revokeObjectURL(preview);
      if (abortRef.current === controller) {
        abortRef.current = null;
        setUpload(null);
        onUploadingChange?.(false);
      }
    }
  };

  const pick = () => inputRef.current?.click();
  const cancel = () => abortRef.current?.abort();

  const shown = upload?.preview ?? value?.url ?? null;
  const percent = Math.round((upload?.progress ?? 0) * 100);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="text-xs font-medium text-slate-600">{label}</label>
        <span className="text-[11px] text-slate-400">JPG, PNG, WebP, AVIF · en fazla 5 MB</span>
      </div>
      {hint ? <p className="-mt-1 text-xs text-slate-500">{hint}</p> : null}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT.join(",")}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void start(f);
        }}
      />

      {shown ? (
        <div className="animate-scale-in overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          <div className={`relative w-full ${aspect}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown} alt="" className={`h-full w-full ${aspect === "aspect-square" ? "object-contain p-3" : "object-cover"} transition duration-300 ${upload ? "scale-[1.02] blur-[1px] brightness-90" : ""}`} />
            {upload ? (
              <div className="absolute inset-0 grid place-items-center bg-slate-900/35 backdrop-blur-[1px]" aria-live="polite">
                <div className="w-3/4 max-w-60 space-y-2 text-center text-white">
                  <p className="text-sm font-semibold tabular-nums">{percent < 100 ? `Yükleniyor %${percent}` : "İşleniyor…"}</p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/30" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Yükleme ilerlemesi">
                    <div className="h-full rounded-full bg-white transition-[width] duration-200 ease-out-expo" style={{ width: `${Math.max(4, percent)}%` }} />
                  </div>
                  <button type="button" onClick={cancel} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white/90 hover:bg-white/15">
                    <X className="h-3.5 w-3.5" /> İptal
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          {!upload ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-3 py-2">
              <button type="button" onClick={pick} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-50">
                <RefreshCw className="h-3.5 w-3.5" /> Değiştir
              </button>
              <button type="button" onClick={() => onChange(null)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-600 transition hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5" /> Kaldır
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={pick}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void start(f);
          }}
          className={`group flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition duration-200 ${
            dragging ? "scale-[1.01] border-[#7367f0] bg-indigo-50/70" : "border-slate-300 bg-slate-50/60 hover:border-[#7367f0]/60 hover:bg-indigo-50/40"
          }`}
        >
          <span className={`grid size-11 place-items-center rounded-full bg-white text-[#7367f0] shadow-sm ring-1 ring-slate-200 transition duration-300 ease-out-expo ${dragging ? "-translate-y-1 scale-110" : "group-hover:-translate-y-0.5"}`}>
            <ImageUp className="h-5 w-5" />
          </span>
          <span className="text-sm text-slate-600">
            {dragging ? "Bırakın, yükleyelim" : <>Sürükleyip bırakın veya <span className="font-semibold text-[#7367f0]">bilgisayardan seçin</span></>}
          </span>
        </button>
      )}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
