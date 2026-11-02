"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { isoToLocalInput, localInputToIso } from "@/lib/form-values";
import { AdminBadge, AdminCard } from "@/components/admin/ui";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Field, inputCls } from "@/components/admin/form";
import { ImageUpload, type UploadedImage } from "@/features/media/ImageUpload";
import { sectionState, type SlideRow, type SliderRow } from "@/modules/showcase/domain/showcase";
import { move, showcaseApi } from "./api";
import { NewNameButton } from "./NewNameButton";

const STATE = { live: { label: "Yayında", tone: "green" }, scheduled: { label: "Zamanlandı", tone: "blue" }, ended: { label: "Süresi doldu", tone: "amber" }, off: { label: "Kapalı", tone: "slate" } } as const;

/** Slider: slides of the selected slider — image, text, link, schedule, order. */
export function SlidersPanel({ sliders, now }: { sliders: SliderRow[]; now: string }) {
  const router = useRouter();
  const [sliderId, setSliderId] = useState(sliders[0]?.id ?? "");
  const slider = sliders.find((s) => s.id === sliderId) ?? sliders[0];
  const [editing, setEditing] = useState<SlideRow | "new" | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "slide"; slide: SlideRow } | { kind: "slider" } | null>(null);
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
      setConfirm(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field id="slider-pick" label="Slider">
          <select id="slider-pick" className={`${inputCls} min-w-64`} value={slider?.id ?? ""} onChange={(e) => setSliderId(e.target.value)}>
            {sliders.map((s) => <option key={s.id} value={s.id}>{s.name}{s.usedBy ? " · ana sayfada" : ""}</option>)}
          </select>
        </Field>
        <div className="flex flex-wrap gap-2">
          <NewNameButton label="Yeni slider" placeholder="Kampanya slider'ı" onCreate={async (name) => { const r = await showcaseApi.createSlider(name); setSliderId(r.data.id); router.refresh(); }} />
          {slider && !slider.usedBy ? <button type="button" onClick={() => setConfirm({ kind: "slider" })} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-600 hover:bg-red-50"><Trash2 className="size-4" />Slider’ı sil</button> : null}
          {slider ? <button type="button" onClick={() => setEditing("new")} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df]"><Plus className="size-4" />Slayt ekle</button> : null}
        </div>
      </div>

      {!slider ? <p className="text-sm text-slate-500">Henüz slider yok.</p> : slider.slides.length === 0 ? (
        <AdminCard className="px-6 py-10 text-center text-sm text-slate-500">Bu sliderda slayt yok.</AdminCard>
      ) : (
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {slider.slides.map((s, i) => {
            const st = STATE[sectionState(s, now)];
            return (
              <li key={s.id}>
                <AdminCard className="overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.desktop.url} alt="" className="aspect-[16/6] w-full bg-slate-100 object-cover" />
                  <div className="space-y-2 p-4">
                    <p className="flex items-center gap-2"><span className="text-xs font-semibold text-slate-400">#{i + 1}</span><span className="truncate font-medium text-slate-800">{s.title}</span></p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><AdminBadge tone={st.tone}>{st.label}</AdminBadge>{s.targetUrl ? <span className="truncate">→ {s.targetUrl}</span> : null}{s.mobile ? <span>· mobil görsel</span> : null}</p>
                    <div className="flex items-center gap-1 pt-1">
                      <button type="button" disabled={busy || i === 0} onClick={() => run(() => showcaseApi.orderSlides(slider.id, move(slider.slides.map((x) => x.id), i, -1)), "Sıralama güncellendi")} aria-label="Öne al" className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="size-4" /></button>
                      <button type="button" disabled={busy || i === slider.slides.length - 1} onClick={() => run(() => showcaseApi.orderSlides(slider.id, move(slider.slides.map((x) => x.id), i, 1)), "Sıralama güncellendi")} aria-label="Arkaya al" className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="size-4" /></button>
                      <button type="button" onClick={() => setEditing(s)} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50"><Pencil className="size-3.5" />Düzenle</button>
                      <button type="button" onClick={() => setConfirm({ kind: "slide", slide: s })} aria-label={`${s.title} sil`} className="grid size-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-3.5" /></button>
                    </div>
                  </div>
                </AdminCard>
              </li>
            );
          })}
        </ol>
      )}

      <AdminDrawer open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Yeni slayt" : editing ? "Slaytı düzenle" : ""} subtitle={slider?.name}>
        {editing && slider ? <SlideForm key={editing === "new" ? "new" : editing.id} sliderId={slider.id} slide={editing === "new" ? null : editing} onDone={() => { setEditing(null); router.refresh(); }} /> : null}
      </AdminDrawer>

      <AdminConfirmDialog open={!!confirm} busy={busy} onCancel={() => setConfirm(null)} confirmLabel="Evet, sil"
        title={confirm?.kind === "slider" ? "Slider silinsin mi?" : "Slayt silinsin mi?"}
        description={confirm?.kind === "slider" ? `“${slider?.name}” ve tüm slaytları silinecek.` : confirm?.kind === "slide" ? `“${confirm.slide.title}” silinecek.` : undefined}
        onConfirm={() => {
          if (!confirm || !slider) return;
          if (confirm.kind === "slider") void run(() => showcaseApi.deleteSlider(slider.id), "Slider silindi").then(() => setSliderId(""));
          else void run(() => showcaseApi.deleteSlide(slider.id, confirm.slide.id), "Slayt silindi");
        }} />
    </div>
  );
}

function SlideForm({ sliderId, slide, onDone }: { sliderId: string; slide: SlideRow | null; onDone: () => void }) {
  const [f, setF] = useState({
    title: slide?.title ?? "", subtitle: slide?.subtitle ?? "", ctaLabel: slide?.ctaLabel ?? "", targetUrl: slide?.targetUrl ?? "",
    desktop: slide?.desktop ?? null as UploadedImage | null, mobile: slide?.mobile ?? null as UploadedImage | null, isActive: slide?.isActive ?? true,
    startsAt: isoToLocalInput(slide?.startsAt), endsAt: isoToLocalInput(slide?.endsAt),
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const errors = useFieldErrors();
  const fe = errors.get;
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.desktop) {
      errors.set({ desktopMediaId: ["Masaüstü görseli yükleyin."] });
      return;
    }
    setBusy(true);
    errors.clear();
    try {
      await showcaseApi.saveSlide(sliderId, slide?.id ?? null, {
        title: f.title, subtitle: f.subtitle || null, ctaLabel: f.ctaLabel || null, targetUrl: f.targetUrl || null, desktopMediaId: f.desktop.id,
        mobileMediaId: f.mobile?.id ?? null, isActive: f.isActive, startsAt: localInputToIso(f.startsAt), endsAt: localInputToIso(f.endsAt),
      });
      notify.success(slide ? "Slayt güncellendi" : "Slayt eklendi", { description: f.title });
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
      <ImageUpload label="Masaüstü görseli *" hint="Yatay görsel (ör. 1600×640)." folder="showcase" aspect="aspect-[5/2]" value={f.desktop} onChange={(desktop) => set({ desktop })} onUploadingChange={setUploading} error={fe("desktopMediaId")} />
      <ImageUpload label="Mobil görsel (isteğe bağlı)" hint="Dikeye yakın görsel; yoksa masaüstü kullanılır." folder="showcase" aspect="aspect-[4/5]" value={f.mobile} onChange={(mobile) => set({ mobile })} onUploadingChange={setUploading} />
      <Field id="sl-title" label="Başlık" required error={fe("title")}><input id="sl-title" className={inputCls} value={f.title} maxLength={160} onChange={(e) => set({ title: e.target.value })} aria-invalid={!!fe("title")} /></Field>
      <Field id="sl-sub" label="Alt metin" error={fe("subtitle")}><textarea id="sl-sub" className={`${inputCls} min-h-20 py-2`} value={f.subtitle} maxLength={300} onChange={(e) => set({ subtitle: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="sl-cta" label="Buton metni" error={fe("ctaLabel")}><input id="sl-cta" className={inputCls} value={f.ctaLabel} maxLength={40} placeholder="Keşfet" onChange={(e) => set({ ctaLabel: e.target.value })} /></Field>
        <Field id="sl-link" label="Bağlantı" error={fe("targetUrl")} hint="/kategori/… veya https://…"><input id="sl-link" className={inputCls} value={f.targetUrl} maxLength={500} onChange={(e) => set({ targetUrl: e.target.value })} aria-invalid={!!fe("targetUrl")} /></Field>
      </div>
      <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-xs font-medium text-slate-600">Yayın</legend>
        <label className="flex items-center justify-between gap-3 text-sm text-slate-700">Yayında<input type="checkbox" className="size-5 accent-[#7367f0]" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="sl-start" label="Başlangıç" hint="Boş = hemen"><input id="sl-start" type="datetime-local" className={inputCls} value={f.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></Field>
          <Field id="sl-end" label="Bitiş" error={fe("endsAt")} hint="Boş = süresiz"><input id="sl-end" type="datetime-local" className={inputCls} value={f.endsAt} onChange={(e) => set({ endsAt: e.target.value })} /></Field>
        </div>
      </fieldset>
      <button type="submit" disabled={busy || uploading} className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60">
        {busy ? "Bekleyin…" : slide ? "Güncelle" : "Slaytı ekle"}
      </button>
    </form>
  );
}
