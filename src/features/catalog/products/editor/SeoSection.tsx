"use client";

import { slugify } from "@/lib/slug";
import { AdminBadge } from "@/components/admin/ui";
import type { FormState } from "./form-state";
import { type SectionProps, labelCls, inputCls, SectionShell, Field, Counter } from "./fields";

// --- SEO --------------------------------------------------------------------
export function SeoSection({ form, patch, fe }: SectionProps) {
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
