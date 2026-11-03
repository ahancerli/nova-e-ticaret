"use client";

import { useRouter } from "next/navigation";
import { useState, type ComponentType } from "react";
import { ArrowDown, ArrowUp, CircleDot, Clapperboard, Grid3x3, Image as ImageIcon, LayoutGrid, Pencil, Plus, Rows3, Tags, Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { isoToLocalInput, localInputToIso } from "@/lib/form-values";
import { AdminBadge, AdminCard } from "@/components/admin/ui";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Field, inputCls } from "@/components/admin/form";
import { OrderedPicker, type PickOption } from "@/components/admin/OrderedPicker";
import { ImageUpload, type UploadedImage } from "@/features/media/ImageUpload";
import {
  SECTION_TYPES, SECTION_TYPE_KEYS, SELECTION_MODES, isProductSection, sectionState,
  type SectionInput, type SectionRow, type SectionType, type SelectionMode, type SliderRow, type StoryCollectionRow,
} from "@/modules/showcase/domain/showcase";
import { move, showcaseApi } from "./api";

export interface ShowcaseOptions {
  products: PickOption[];
  categories: PickOption[];
  brands: PickOption[];
}

const ICON: Record<SectionType, ComponentType<{ className?: string }>> = {
  hero_slider: Clapperboard, story_strip: CircleDot, product_carousel: Rows3, product_grid: Grid3x3, category_tiles: LayoutGrid, brand_strip: Tags, banner: ImageIcon,
};
const STATE = { live: { label: "Yayında", tone: "green" }, scheduled: { label: "Zamanlandı", tone: "blue" }, ended: { label: "Süresi doldu", tone: "amber" }, off: { label: "Kapalı", tone: "slate" } } as const;

function summary(s: SectionRow, sliders: SliderRow[], collections: StoryCollectionRow[]): string {
  switch (s.type) {
    case "hero_slider": { const sl = sliders.find((x) => x.id === s.sliderId); return sl ? `${sl.name} · ${sl.slides.length} slayt` : "Slider seçilmedi"; }
    case "story_strip": { const c = collections.find((x) => x.id === s.storyCollectionId); return c ? `${c.name} · ${c.stories.length} hikaye` : "Koleksiyon seçilmedi"; }
    case "category_tiles": return `${s.categoryIds.length} kategori`;
    case "brand_strip": return `${s.brandIds.length} marka`;
    case "banner": return s.targetUrl ? `→ ${s.targetUrl}` : s.media ? "Görsel var" : "Görsel yok";
    default: return s.selectionMode === "manual" ? `${s.productIds.length} ürün (elle)` : `${SELECTION_MODES[s.selectionMode]} · en fazla ${s.itemLimit}`;
  }
}

/** Ana sayfa düzeni: sections in order — move, switch on/off, edit in a drawer, delete. */
export function SectionsPanel({ sections, sliders, collections, options, now }: {
  sections: SectionRow[];
  sliders: SliderRow[];
  collections: StoryCollectionRow[];
  options: ShowcaseOptions;
  now: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<SectionRow | "new" | null>(null);
  const [newType, setNewType] = useState<SectionType | null>(null);
  const [deleting, setDeleting] = useState<SectionRow | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      notify.success(ok);
      router.refresh();
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(false);
    }
  };
  const reorder = (i: number, d: -1 | 1) => run(() => showcaseApi.orderSections(move(sections.map((s) => s.id), i, d)), "Sıralama güncellendi");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Bölümler ana sayfada bu sırayla görünür. Kapalı veya zamanı gelmemiş bölümler gösterilmez.</p>
        <div className="flex gap-2">
          <a href="/" target="_blank" rel="noopener" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Ana sayfayı aç</a>
          <button type="button" onClick={() => { setNewType(null); setEditing("new"); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df]">
            <Plus className="size-4" />Bölüm ekle
          </button>
        </div>
      </div>

      <ol className="space-y-2">
        {sections.map((s, i) => {
          const Icon = ICON[s.type];
          const st = STATE[sectionState(s, now)];
          return (
            <li key={s.id}>
              <AdminCard className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="w-6 text-center text-sm font-semibold tabular-nums text-slate-400">{i + 1}</span>
                <span className="grid size-10 flex-none place-items-center rounded-xl bg-[#7367f0]/10 text-[#7367f0]"><Icon className="size-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2"><span className="font-medium text-slate-800">{s.title}</span><AdminBadge tone={st.tone}>{st.label}</AdminBadge></span>
                  <span className="block truncate text-xs text-slate-500">{SECTION_TYPES[s.type].label} · {summary(s, sliders, collections)}</span>
                </span>
                <span className="flex items-center gap-1">
                  <button type="button" disabled={busy || i === 0} onClick={() => reorder(i, -1)} aria-label={`${s.title} yukarı taşı`} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="size-4" /></button>
                  <button type="button" disabled={busy || i === sections.length - 1} onClick={() => reorder(i, 1)} aria-label={`${s.title} aşağı taşı`} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="size-4" /></button>
                  <label className="mx-1 inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" className="size-4 accent-[#7367f0]" checked={s.isActive} disabled={busy} aria-label={`${s.title} yayında`}
                      onChange={(e) => run(() => showcaseApi.toggleSection(s.id, e.target.checked), e.target.checked ? "Bölüm açıldı" : "Bölüm kapatıldı")} />Açık
                  </label>
                  <button type="button" onClick={() => setEditing(s)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Pencil className="size-3.5" />Düzenle</button>
                  <button type="button" onClick={() => setDeleting(s)} aria-label={`${s.title} sil`} className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
                </span>
              </AdminCard>
            </li>
          );
        })}
      </ol>

      <AdminDrawer open={editing !== null} onClose={() => setEditing(null)}
        title={editing === "new" ? (newType ? `Yeni bölüm: ${SECTION_TYPES[newType].label}` : "Bölüm türü seçin") : editing ? `${editing.title} düzenle` : ""}
        subtitle={editing && editing !== "new" ? SECTION_TYPES[editing.type].label : undefined}>
        {editing === "new" && !newType ? (
          <ul className="grid gap-2">
            {SECTION_TYPE_KEYS.map((t) => {
              const Icon = ICON[t];
              return (
                <li key={t}>
                  <button type="button" onClick={() => setNewType(t)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-[#7367f0] hover:bg-[#7367f0]/5">
                    <Icon className="size-5 flex-none text-[#7367f0]" />
                    <span><span className="block text-sm font-medium text-slate-800">{SECTION_TYPES[t].label}</span><span className="block text-xs text-slate-500">{SECTION_TYPES[t].hint}</span></span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : editing ? (
          <SectionForm key={editing === "new" ? `new-${newType}` : editing.id} section={editing === "new" ? null : editing} type={editing === "new" ? newType! : editing.type}
            sliders={sliders} collections={collections} options={options} onDone={() => { setEditing(null); router.refresh(); }} />
        ) : null}
      </AdminDrawer>

      <AdminConfirmDialog open={!!deleting} title="Bölüm silinsin mi?" description={deleting ? `“${deleting.title}” ana sayfadan kaldırılacak. Slider ve hikayeler silinmez.` : undefined}
        confirmLabel="Evet, sil" busy={busy} onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && run(() => showcaseApi.deleteSection(deleting.id), "Bölüm silindi").then(() => setDeleting(null))} />
    </div>
  );
}

function SectionForm({ section, type, sliders, collections, options, onDone }: {
  section: SectionRow | null;
  type: SectionType;
  sliders: SliderRow[];
  collections: StoryCollectionRow[];
  options: ShowcaseOptions;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    title: section?.title ?? SECTION_TYPES[type].label, subtitle: section?.subtitle ?? "", sliderId: section?.sliderId ?? sliders[0]?.id ?? "",
    storyCollectionId: section?.storyCollectionId ?? collections[0]?.id ?? "", selectionMode: (section?.selectionMode ?? "manual") as SelectionMode,
    itemLimit: String(section?.itemLimit ?? 12), productIds: section?.productIds ?? [], categoryIds: section?.categoryIds ?? [], brandIds: section?.brandIds ?? [],
    media: section?.media ?? null as UploadedImage | null, mobileMedia: section?.mobileMedia ?? null as UploadedImage | null,
    targetUrl: section?.targetUrl ?? "", ctaLabel: section?.ctaLabel ?? "", isActive: section?.isActive ?? true,
    startsAt: isoToLocalInput(section?.startsAt), endsAt: isoToLocalInput(section?.endsAt),
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const errors = useFieldErrors();
  const fe = errors.get;
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    errors.clear();
    const input: SectionInput = {
      title: f.title, subtitle: f.subtitle || null, type, sliderId: f.sliderId || null, storyCollectionId: f.storyCollectionId || null, selectionMode: f.selectionMode,
      itemLimit: Number(f.itemLimit) || 12, productIds: f.productIds, categoryIds: f.categoryIds, brandIds: f.brandIds, mediaId: f.media?.id ?? null, mobileMediaId: f.mobileMedia?.id ?? null,
      targetUrl: f.targetUrl || null, ctaLabel: f.ctaLabel || null, isActive: f.isActive, startsAt: localInputToIso(f.startsAt), endsAt: localInputToIso(f.endsAt),
    };
    try {
      if (section) await showcaseApi.updateSection(section.id, { ...input, expectedUpdatedAt: section.updatedAt });
      else await showcaseApi.createSection(input);
      notify.success(section ? "Bölüm güncellendi" : "Bölüm eklendi", { description: f.title });
      onDone();
    } catch (err) {
      const n = errors.fromError(err);
      notify.error(err, { description: n ? "İşaretli alanları kontrol edin." : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="space-y-5">
      <Field id="sec-title" label={type === "banner" ? "Banner başlığı" : "Başlık"} required error={fe("title")}>
        <input id="sec-title" className={inputCls} value={f.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} aria-invalid={!!fe("title")} />
      </Field>
      {type !== "hero_slider" && type !== "story_strip" ? (
        <Field id="sec-sub" label={type === "banner" ? "Alt metin" : "Üst başlık (küçük)"} error={fe("subtitle")}>
          <input id="sec-sub" className={inputCls} value={f.subtitle} maxLength={160} onChange={(e) => set({ subtitle: e.target.value })} />
        </Field>
      ) : null}

      {type === "hero_slider" ? (
        <Field id="sec-slider" label="Slider" required error={fe("sliderId")} hint="Slaytları “Slider” sekmesinden yönetin.">
          <select id="sec-slider" className={inputCls} value={f.sliderId} onChange={(e) => set({ sliderId: e.target.value })}>
            {sliders.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.slides.length} slayt)</option>)}
          </select>
        </Field>
      ) : null}
      {type === "story_strip" ? (
        <Field id="sec-col" label="Hikaye koleksiyonu" required error={fe("storyCollectionId")} hint="Hikayeleri “Hikayeler” sekmesinden yönetin.">
          <select id="sec-col" className={inputCls} value={f.storyCollectionId} onChange={(e) => set({ storyCollectionId: e.target.value })}>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.stories.length} hikaye)</option>)}
          </select>
        </Field>
      ) : null}
      {isProductSection(type) ? (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
            <Field id="sec-mode" label="Ürün seçimi">
              <select id="sec-mode" className={inputCls} value={f.selectionMode} onChange={(e) => set({ selectionMode: e.target.value as SelectionMode })}>
                {(Object.entries(SELECTION_MODES) as [SelectionMode, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field id="sec-limit" label="En fazla"><input id="sec-limit" type="number" min={1} max={48} className={inputCls} value={f.itemLimit} onChange={(e) => set({ itemLimit: e.target.value })} /></Field>
          </div>
          {f.selectionMode === "manual"
            ? <OrderedPicker id="sec-products" label="Ürünler" options={options.products} value={f.productIds} onChange={(productIds) => set({ productIds })} max={48} error={fe("productIds")} />
            : <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">Ürünler her ziyarette güncel veriden otomatik seçilir.</p>}
        </>
      ) : null}
      {type === "category_tiles" ? <OrderedPicker id="sec-cats" label="Kategoriler" options={options.categories} value={f.categoryIds} onChange={(categoryIds) => set({ categoryIds })} max={24} error={fe("categoryIds")} /> : null}
      {type === "brand_strip" ? <OrderedPicker id="sec-brands" label="Markalar" options={options.brands} value={f.brandIds} onChange={(brandIds) => set({ brandIds })} max={48} error={fe("brandIds")} /> : null}
      {type === "banner" ? (
        <>
          <ImageUpload label="Görsel" hint="Geniş görsel (en az 1600×500 önerilir)." folder="showcase" aspect="aspect-[16/5]" value={f.media}
            onChange={(media) => set({ media })} onUploadingChange={setUploading} error={fe("mediaId")} />
          <ImageUpload label="Mobil görsel (isteğe bağlı)" folder="showcase" aspect="aspect-[4/3]" value={f.mobileMedia} onChange={(mobileMedia) => set({ mobileMedia })} onUploadingChange={setUploading} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="sec-link" label="Bağlantı" error={fe("targetUrl")} hint="/kategori/… veya https://…"><input id="sec-link" className={inputCls} value={f.targetUrl} maxLength={500} onChange={(e) => set({ targetUrl: e.target.value })} aria-invalid={!!fe("targetUrl")} /></Field>
            <Field id="sec-cta" label="Buton metni" error={fe("ctaLabel")}><input id="sec-cta" className={inputCls} value={f.ctaLabel} maxLength={40} placeholder="Keşfet" onChange={(e) => set({ ctaLabel: e.target.value })} /></Field>
          </div>
        </>
      ) : null}

      <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-xs font-medium text-slate-600">Yayın</legend>
        <label className="flex items-center justify-between gap-3 text-sm text-slate-700">Ana sayfada göster<input type="checkbox" className="size-5 accent-[#7367f0]" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="sec-start" label="Başlangıç" hint="Boş = hemen"><input id="sec-start" type="datetime-local" className={inputCls} value={f.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></Field>
          <Field id="sec-end" label="Bitiş" error={fe("endsAt")} hint="Boş = süresiz"><input id="sec-end" type="datetime-local" className={inputCls} value={f.endsAt} onChange={(e) => set({ endsAt: e.target.value })} /></Field>
        </div>
      </fieldset>

      <button type="submit" disabled={busy || uploading} className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60">
        {busy ? "Bekleyin…" : section ? "Güncelle" : "Bölümü ekle"}
      </button>
    </form>
  );
}
