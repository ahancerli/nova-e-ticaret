"use client";

import { Lock } from "lucide-react";
import { slugify } from "@/lib/slug";
import { type Status, STATUSES, TAX_RATES } from "./form-state";
import { type SectionProps, inputCls, SectionShell, Field, Counter } from "./fields";

// --- Genel bilgiler ---------------------------------------------------------
export function GeneralSection({ form, patch, fe, canPublish, wasPublished }: SectionProps & { canPublish: boolean; wasPublished: boolean }) {
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
