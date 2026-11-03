"use client";

import { useRef, useState } from "react";
import { ImagePlus, RotateCcw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { Counter, Field, inputCls } from "@/components/admin/form";
import { uploadImage } from "@/features/media/api";
import type { GalleryItem } from "@/features/media/MediaGallery";
import {
  AI_DEFAULT_FIELDS, AI_IMAGE_MIME, AI_MAX_IMAGES, AI_PRODUCT_FIELDS, AI_PRODUCT_FIELD_KEYS, AI_PROMPT_MAX, AI_PROMPT_MIN,
  type AiProductField, type GenerateProductResult,
} from "@/modules/ai/domain/providers";
import { productsApi } from "../api";

const MAX_BYTES = 5 * 1024 * 1024;

export type AiApply = { result: GenerateProductResult; images: GalleryItem[] };

/**
 * "AI ile ürün ekle": pick the fields, give 1–2 photos and a short description, generate with the shop's AI
 * provider, preview, then apply to the form. The developer-owned system prompt is applied on the server.
 */
export function AiProductDrawer({ open, providerLabel, onClose, onApply }: {
  open: boolean;
  providerLabel: string;
  onClose: () => void;
  onApply: (a: AiApply) => void;
}) {
  const errors = useFieldErrors();
  const [fields, setFields] = useState<Set<AiProductField>>(() => new Set(AI_DEFAULT_FIELDS));
  const [images, setImages] = useState<GalleryItem[]>([]);
  const [uploading, setUploading] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenerateProductResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const toggle = (f: AiProductField) => setFields((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });

  const addFiles = (list: FileList | null) => {
    const files = [...(list ?? [])].slice(0, Math.max(0, AI_MAX_IMAGES - images.length - uploading));
    for (const file of files) {
      if (!(AI_IMAGE_MIME as readonly string[]).includes(file.type)) { notify.error("AI için JPG, PNG veya WebP görsel yükleyin.", { description: file.name }); continue; }
      if (file.size > MAX_BYTES) { notify.error("Görsel en fazla 5 MB olabilir.", { description: file.name }); continue; }
      setUploading((n) => n + 1);
      uploadImage(file, "products")
        .then((r) => { setImages((cur) => [...cur, { mediaId: r.data.id, url: r.data.url }].slice(0, AI_MAX_IMAGES)); errors.clear("mediaIds"); })
        .catch((err) => notify.error(err, { fallback: "Görsel yüklenemedi.", description: file.name }))
        .finally(() => setUploading((n) => n - 1));
    }
  };

  const generate = async () => {
    if (busy || uploading) return;
    errors.clear();
    const local: Record<string, string[]> = {};
    if (!fields.size) local.fields = ["En az bir alan seçin."];
    if (!images.length) local.mediaIds = ["En az bir ürün görseli yükleyin."];
    if (prompt.trim().length < AI_PROMPT_MIN) local.prompt = [`Ürünü en az ${AI_PROMPT_MIN} karakterle anlatın.`];
    if (Object.keys(local).length) return errors.set(local);
    setBusy(true);
    try {
      const r = await productsApi.aiGenerate({ fields: [...fields], prompt: prompt.trim(), mediaIds: images.map((i) => i.mediaId) });
      setResult(r.data);
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { id: "ai-generate", fallback: "AI içerik oluşturamadı." });
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!result) return;
    onApply({ result, images: fields.has("images") ? images : [] });
  };

  const d = result?.draft;
  const footer = result ? (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={() => setResult(null)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <RotateCcw className="h-4 w-4" /> Düzenle ve yeniden oluştur
      </button>
      <button type="button" onClick={apply} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white hover:bg-[#6559df]">
        <Wand2 className="h-4 w-4" /> Forma uygula
      </button>
    </div>
  ) : (
    <div className="flex justify-end">
      <button type="button" onClick={generate} disabled={busy || uploading > 0}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60">
        <Sparkles className={`h-4 w-4 ${busy ? "animate-pulse" : ""}`} /> {busy ? "AI oluşturuyor…" : uploading ? "Görseller yükleniyor…" : "AI ile oluştur"}
      </button>
    </div>
  );

  return (
    <AdminDrawer open={open} onClose={busy ? () => {} : onClose} title="AI ile ürün ekle" subtitle={`${providerLabel} ile çalışır · sonuç kaydetmeden önce forma gelir`} footer={footer}>
      {result && d ? (
        <div className="space-y-4 p-5 text-sm">
          <p className="rounded-lg bg-indigo-50 px-3 py-2 text-[#5b4fe0] ring-1 ring-indigo-100">
            {result.providerLabel} · {result.model} bu içeriği önerdi. “Forma uygula” ile ilgili alanlar doldurulur; ürünü kontrol edip kaydedin.
          </p>
          {d.name ? <Preview label="Ürün adı"><p className="font-medium text-slate-900">{d.name}</p></Preview> : null}
          {d.shortDescription ? <Preview label="Kısa açıklama"><p>{d.shortDescription}</p></Preview> : null}
          {d.descriptionHtml ? (
            <Preview label="Açıklama">
              {/* Sanitised on the server with the shop's HTML allowlist (sanitizeRichHtml). */}
              <div className="prose prose-sm max-w-none text-slate-700" dangerouslySetInnerHTML={{ __html: d.descriptionHtml }} />
            </Preview>
          ) : null}
          {d.seo ? <Preview label="SEO"><p className="font-medium text-slate-800">{d.seo.metaTitle || "—"}</p><p className="text-slate-500">{d.seo.metaDescription || "—"}</p></Preview> : null}
          {fields.has("images") && images.length ? (
            <Preview label="Galeriye eklenecek görseller">
              <div className="flex gap-2">{images.map((i) => <Thumb key={i.mediaId} url={i.url} />)}</div>
            </Preview>
          ) : null}
          {Object.keys(d).length === 0 && !(fields.has("images") && images.length) ? <p className="text-slate-500">Seçilen alanlar için içerik oluşmadı.</p> : null}
        </div>
      ) : (
        <div className="space-y-6 p-5 text-sm">
          <section>
            <h3 className="mb-2 font-semibold text-slate-800">1. Hangi alanlar AI ile oluşturulsun?</h3>
            <div className="grid gap-2 sm:grid-cols-2" data-invalid={errors.has("fields")}>
              {AI_PRODUCT_FIELD_KEYS.map((f) => (
                <label key={f} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${fields.has(f) ? "border-[#7367f0] bg-indigo-50/50" : "border-slate-200 hover:bg-slate-50"}`}>
                  <input type="checkbox" className="mt-0.5 size-4 flex-none accent-[#7367f0]" checked={fields.has(f)} onChange={() => toggle(f)} />
                  <span>
                    <span className="block font-medium text-slate-800">{AI_PRODUCT_FIELDS[f].label}</span>
                    <span className="block text-xs text-slate-500">{AI_PRODUCT_FIELDS[f].hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {errors.get("fields") ? <p className="mt-1 text-xs text-red-600">{errors.get("fields")}</p> : null}
          </section>

          <section>
            <h3 className="mb-1 font-semibold text-slate-800">2. Ürün görselleri</h3>
            <p className="mb-2 text-xs text-slate-500">1 veya {AI_MAX_IMAGES} fotoğraf (JPG, PNG, WebP; en fazla 5 MB). AI ürünü bu görsellerden tanır.</p>
            <input ref={inputRef} type="file" multiple accept={AI_IMAGE_MIME.join(",")} className="sr-only" tabIndex={-1} aria-hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <div className="flex flex-wrap gap-3" data-invalid={errors.has("mediaIds")}>
              {images.map((i) => (
                <div key={i.mediaId} className="relative">
                  <Thumb url={i.url} />
                  <button type="button" aria-label="Görseli kaldır" onClick={() => setImages((cur) => cur.filter((x) => x.mediaId !== i.mediaId))}
                    className="absolute right-1 top-1 grid size-7 place-items-center rounded-md bg-white/90 text-red-600 shadow hover:bg-white">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {Array.from({ length: uploading }, (_, i) => <div key={`u${i}`} className="skeleton size-24 rounded-xl" aria-label="Yükleniyor" />)}
              {images.length + uploading < AI_MAX_IMAGES ? (
                <button type="button" onClick={() => inputRef.current?.click()}
                  className={`flex size-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-xs font-medium transition ${errors.has("mediaIds") ? "border-red-300 text-red-600" : "border-slate-300 text-slate-500 hover:border-[#7367f0] hover:text-[#5b4fe0]"}`}>
                  <ImagePlus className="h-5 w-5" /> Görsel ekle
                </button>
              ) : null}
            </div>
            {errors.get("mediaIds") ? <p className="mt-1 text-xs text-red-600">{errors.get("mediaIds")}</p> : null}
          </section>

          <section>
            <h3 className="mb-2 font-semibold text-slate-800">3. Ürünü kısaca anlatın</h3>
            <Field id="ai-prompt" label="Açıklama" required error={errors.get("prompt")}
              hint={<span className="flex justify-between gap-2"><span>Ör. “Erkek yün kazak, lacivert, boğazlı, kışlık, %50 yün.”</span><Counter value={prompt} max={AI_PROMPT_MAX} /></span>}>
              <textarea id="ai-prompt" rows={4} maxLength={AI_PROMPT_MAX} className={`${inputCls} py-2`} value={prompt} aria-invalid={errors.has("prompt")}
                onChange={(e) => { setPrompt(e.target.value); errors.clear("prompt"); }} />
            </Field>
          </section>
        </div>
      )}
    </AdminDrawer>
  );
}

function Preview({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 p-3">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h4>
      <div className="text-slate-700">{children}</div>
    </section>
  );
}

function Thumb({ url }: { url: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="size-24 rounded-xl border border-slate-200 object-cover" />;
}
