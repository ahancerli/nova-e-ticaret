"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { isoToLocalInput, localInputToIso } from "@/lib/form-values";
import { AdminBadge, AdminCard } from "@/components/admin/ui";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Field, inputCls } from "@/components/admin/form";
import type { PickOption } from "@/components/admin/OrderedPicker";
import { ImageUpload, type UploadedImage } from "@/features/media/ImageUpload";
import { sectionState, type StoryCollectionRow, type StoryRow } from "@/modules/showcase/domain/showcase";
import { move, showcaseApi } from "./api";
import { NewNameButton } from "./NewNameButton";

const STATE = { live: { label: "Yayında", tone: "green" }, scheduled: { label: "Zamanlandı", tone: "blue" }, ended: { label: "Süresi doldu", tone: "amber" }, off: { label: "Kapalı", tone: "slate" } } as const;

/** Hikayeler: stories of a collection — brand, cover, frames (images shown in sequence, each optionally linked). */
export function StoriesPanel({ collections, brands, now }: { collections: StoryCollectionRow[]; brands: PickOption[]; now: string }) {
  const router = useRouter();
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? "");
  const col = collections.find((c) => c.id === collectionId) ?? collections[0];
  const [editing, setEditing] = useState<StoryRow | "new" | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "story"; story: StoryRow } | { kind: "collection" } | null>(null);
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
        <Field id="col-pick" label="Koleksiyon">
          <select id="col-pick" className={`${inputCls} min-w-64`} value={col?.id ?? ""} onChange={(e) => setCollectionId(e.target.value)}>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}{c.usedBy ? " · ana sayfada" : ""}</option>)}
          </select>
        </Field>
        <div className="flex flex-wrap gap-2">
          <NewNameButton label="Yeni koleksiyon" placeholder="Kış hikayeleri" onCreate={async (name) => { const r = await showcaseApi.createCollection(name); setCollectionId(r.data.id); router.refresh(); }} />
          {col && !col.usedBy ? <button type="button" onClick={() => setConfirm({ kind: "collection" })} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-600 hover:bg-red-50"><Trash2 className="size-4" />Koleksiyonu sil</button> : null}
          {col ? <button type="button" onClick={() => setEditing("new")} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df]"><Plus className="size-4" />Hikaye ekle</button> : null}
        </div>
      </div>

      {!col ? <p className="text-sm text-slate-500">Henüz koleksiyon yok.</p> : col.stories.length === 0 ? (
        <AdminCard className="px-6 py-10 text-center text-sm text-slate-500">Bu koleksiyonda hikaye yok.</AdminCard>
      ) : (
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {col.stories.map((s, i) => {
            const st = STATE[sectionState(s, now)];
            return (
              <li key={s.id}>
                <AdminCard className="flex items-center gap-3 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.cover?.url ?? s.frames[0]?.media.url ?? "/demo/placeholder.svg"} alt="" className="size-14 flex-none rounded-full border-2 border-[#7367f0]/40 bg-slate-100 object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-800">{s.title}</span>
                    <span className="block truncate text-xs text-slate-500">{s.brandName} · {s.frames.length} kare</span>
                    <AdminBadge tone={st.tone}>{st.label}</AdminBadge>
                  </span>
                  <span className="flex flex-col gap-1">
                    <button type="button" disabled={busy || i === 0} onClick={() => run(() => showcaseApi.orderStories(col.id, move(col.stories.map((x) => x.id), i, -1)), "Sıralama güncellendi")} aria-label="Öne al" className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                    <button type="button" disabled={busy || i === col.stories.length - 1} onClick={() => run(() => showcaseApi.orderStories(col.id, move(col.stories.map((x) => x.id), i, 1)), "Sıralama güncellendi")} aria-label="Arkaya al" className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                  </span>
                  <span className="flex flex-col gap-1">
                    <button type="button" onClick={() => setEditing(s)} aria-label={`${s.title} düzenle`} className="grid size-7 place-items-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"><Pencil className="size-3.5" /></button>
                    <button type="button" onClick={() => setConfirm({ kind: "story", story: s })} aria-label={`${s.title} sil`} className="grid size-7 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-3.5" /></button>
                  </span>
                </AdminCard>
              </li>
            );
          })}
        </ol>
      )}

      <AdminDrawer open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Yeni hikaye" : editing ? "Hikayeyi düzenle" : ""} subtitle={col?.name}>
        {editing && col ? <StoryForm key={editing === "new" ? "new" : editing.id} collectionId={col.id} story={editing === "new" ? null : editing} brands={brands} onDone={() => { setEditing(null); router.refresh(); }} /> : null}
      </AdminDrawer>

      <AdminConfirmDialog open={!!confirm} busy={busy} onCancel={() => setConfirm(null)} confirmLabel="Evet, sil"
        title={confirm?.kind === "collection" ? "Koleksiyon silinsin mi?" : "Hikaye silinsin mi?"}
        description={confirm?.kind === "collection" ? `“${col?.name}” ve tüm hikayeleri silinecek.` : confirm?.kind === "story" ? `“${confirm.story.title}” silinecek.` : undefined}
        onConfirm={() => {
          if (!confirm || !col) return;
          if (confirm.kind === "collection") void run(() => showcaseApi.deleteCollection(col.id), "Koleksiyon silindi").then(() => setCollectionId(""));
          else void run(() => showcaseApi.deleteStory(col.id, confirm.story.id), "Hikaye silindi");
        }} />
    </div>
  );
}

type Frame = { media: UploadedImage | null; targetUrl: string; seconds: string };

function StoryForm({ collectionId, story, brands, onDone }: { collectionId: string; story: StoryRow | null; brands: PickOption[]; onDone: () => void }) {
  const [f, setF] = useState({
    brandId: story?.brandId ?? brands[0]?.id ?? "", title: story?.title ?? "", cover: story?.cover ?? null as UploadedImage | null, isActive: story?.isActive ?? true,
    startsAt: isoToLocalInput(story?.startsAt), endsAt: isoToLocalInput(story?.endsAt),
    frames: (story?.frames.map((x) => ({ media: x.media, targetUrl: x.targetUrl ?? "", seconds: String(x.durationMs / 1000) })) ?? [{ media: null, targetUrl: "", seconds: "5" }]) as Frame[],
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const errors = useFieldErrors();
  const fe = errors.get;
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));
  const setFrame = (i: number, p: Partial<Frame>) => set({ frames: f.frames.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const frames = f.frames.filter((x) => x.media);
    if (!frames.length) {
      errors.set({ frames: ["En az bir kare görseli yükleyin."] });
      return;
    }
    setBusy(true);
    errors.clear();
    try {
      await showcaseApi.saveStory(collectionId, story?.id ?? null, {
        brandId: f.brandId, title: f.title, coverMediaId: f.cover?.id ?? null, isActive: f.isActive, startsAt: localInputToIso(f.startsAt), endsAt: localInputToIso(f.endsAt),
        frames: frames.map((x) => ({ mediaId: x.media!.id, targetUrl: x.targetUrl || null, durationMs: Math.round((Number(x.seconds.replace(",", ".")) || 5) * 1000) })),
      });
      notify.success(story ? "Hikaye güncellendi" : "Hikaye eklendi", { description: f.title });
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="st-brand" label="Marka" required error={fe("brandId")}>
          <select id="st-brand" className={inputCls} value={f.brandId} onChange={(e) => set({ brandId: e.target.value })}>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </Field>
        <Field id="st-title" label="Başlık" required error={fe("title")} hint="Daire altında görünür (kısa tutun).">
          <input id="st-title" className={inputCls} value={f.title} maxLength={60} onChange={(e) => set({ title: e.target.value })} aria-invalid={!!fe("title")} />
        </Field>
      </div>
      <ImageUpload label="Kapak (daire)" hint="Kare görsel; boşsa ilk kare kullanılır." folder="showcase" aspect="aspect-square" value={f.cover} onChange={(cover) => set({ cover })}
        onUploadingChange={(u) => setUploading((n) => n + (u ? 1 : -1))} />

      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-medium text-slate-600">Kareler (sırayla gösterilir)</legend>
        {fe("frames") ? <p className="text-xs text-red-600">{fe("frames")}</p> : null}
        {f.frames.map((x, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Kare {i + 1}</span>
              <span className="flex gap-1">
                <button type="button" disabled={i === 0} onClick={() => set({ frames: move(f.frames, i, -1) })} aria-label="Öne al" className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowLeft className="size-3.5" /></button>
                <button type="button" disabled={i === f.frames.length - 1} onClick={() => set({ frames: move(f.frames, i, 1) })} aria-label="Arkaya al" className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowRight className="size-3.5" /></button>
                <button type="button" disabled={f.frames.length === 1} onClick={() => set({ frames: f.frames.filter((_, j) => j !== i) })} aria-label={`Kare ${i + 1} kaldır`} className="grid size-7 place-items-center rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><X className="size-3.5" /></button>
              </span>
            </div>
            <ImageUpload label="Görsel" folder="showcase" aspect="aspect-[9/16] max-h-64" value={x.media} onChange={(media) => setFrame(i, { media })}
              onUploadingChange={(u) => setUploading((n) => n + (u ? 1 : -1))} error={fe(`frames.${i}.mediaId`)} />
            <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
              <Field id={`fr-link-${i}`} label="Bağlantı" error={fe(`frames.${i}.targetUrl`)}><input id={`fr-link-${i}`} className={inputCls} value={x.targetUrl} maxLength={500} placeholder="/marka/…" onChange={(e) => setFrame(i, { targetUrl: e.target.value })} /></Field>
              <Field id={`fr-sec-${i}`} label="Süre (sn)"><input id={`fr-sec-${i}`} type="number" min={1} max={60} className={inputCls} value={x.seconds} onChange={(e) => setFrame(i, { seconds: e.target.value })} /></Field>
            </div>
          </div>
        ))}
        {f.frames.length < 20 ? <button type="button" onClick={() => set({ frames: [...f.frames, { media: null, targetUrl: "", seconds: "5" }] })} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#7367f0] hover:underline"><Plus className="size-4" />Kare ekle</button> : null}
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-xs font-medium text-slate-600">Yayın</legend>
        <label className="flex items-center justify-between gap-3 text-sm text-slate-700">Yayında<input type="checkbox" className="size-5 accent-[#7367f0]" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="st-start" label="Başlangıç" hint="Boş = hemen"><input id="st-start" type="datetime-local" className={inputCls} value={f.startsAt} onChange={(e) => set({ startsAt: e.target.value })} /></Field>
          <Field id="st-end" label="Bitiş" error={fe("endsAt")} hint="Boş = süresiz"><input id="st-end" type="datetime-local" className={inputCls} value={f.endsAt} onChange={(e) => set({ endsAt: e.target.value })} /></Field>
        </div>
      </fieldset>
      <button type="submit" disabled={busy || uploading > 0} className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60">
        {busy ? "Bekleyin…" : story ? "Güncelle" : "Hikayeyi ekle"}
      </button>
    </form>
  );
}
