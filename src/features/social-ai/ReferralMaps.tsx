"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { Counter, Field, inputCls } from "@/components/admin/form";
import { OrderedPicker, type PickOption } from "@/components/admin/OrderedPicker";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import type { ReferralMapView, ReferralType } from "@/modules/social-ai";
import { MAX_REFERRAL_PRODUCTS, REFERRAL_TYPES, REFERRAL_TYPE_KEYS } from "@/modules/social-ai/domain/social-ai";
import { socialAiApi } from "./api";
import { btn, danger, primary } from "./ui";

const EMPTY = { sourceType: "ad" as ReferralType, sourceId: "", label: "", productIds: [] as string[], extraPrompt: "", isActive: true };
const ID_HINT: Record<ReferralType, string> = {
  ad: "Meta Reklam Yöneticisi'ndeki reklam kimliği (Ad ID). Reklamdan gelen ilk konuşmanın detayında da görünür.",
  post: "Gönderi ya da hikâye kimliği. Bir müşteri o gönderiye yanıt verdiğinde konuşma detayında görünür.",
  ref: "ig.me / wa.me bağlantınıza eklediğiniz ref kodu (ör. kis-kampanyasi).",
};

/** Bot ayarları › Kampanya / reklam eşlemeleri: which ad or post starts the conversation with which products. */
export function ReferralMaps({ maps, products, onChanged }: { maps: ReferralMapView[]; products: PickOption[]; onChanged: () => void }) {
  const errors = useFieldErrors();
  const [editing, setEditing] = useState<ReferralMapView | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ReferralMapView | null>(null);

  const open = (m: ReferralMapView | "new") => {
    errors.clear();
    setForm(m === "new" ? EMPTY : { sourceType: m.sourceType, sourceId: m.sourceId, label: m.label, productIds: m.productIds, extraPrompt: m.extraPrompt, isActive: m.isActive });
    setEditing(m);
  };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      if (editing === "new") await socialAiApi.createReferral(form);
      else await socialAiApi.updateReferral(editing.id, { ...form, expectedUpdatedAt: editing.updatedAt });
      notify.success(editing === "new" ? "Eşleme eklendi" : "Eşleme güncellendi");
      setEditing(null);
      onChanged();
    } catch (err) {
      errors.fromError(err);
      notify.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await socialAiApi.deleteReferral(removing.id);
      notify.success("Eşleme silindi");
      setRemoving(null);
      setEditing(null);
      onChanged();
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminCard>
      <AdminCardTitle title="Kampanya ve reklam eşlemeleri" subtitle="Belirli bir reklamdan ya da gönderiden yazan müşteriyle bot o ürün üzerinden konuşmaya başlar."
        actions={<button type="button" className={btn} onClick={() => open("new")}><Plus className="h-4 w-4" /> Eşleme ekle</button>} />
      {maps.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">Henüz eşleme yok. Eşleme olmadan da bot, reklamın başlığından yola çıkarak ürünü bulmaya çalışır.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {maps.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => open(m)} className="flex w-full items-start justify-between gap-3 px-5 py-3.5 text-left hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{m.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{REFERRAL_TYPES[m.sourceType]} {m.sourceId}{m.products.length ? `, ${m.products.map((p) => p.name).join(", ")}` : ", ürün seçilmedi"}</span>
                </span>
                <AdminBadge tone={m.isActive ? "green" : "slate"}>{m.isActive ? "Kullanılıyor" : "Kapalı"}</AdminBadge>
              </button>
            </li>
          ))}
        </ul>
      )}

      <AdminDrawer open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Eşleme ekle" : "Eşlemeyi güncelle"} subtitle="Reklam ya da gönderi, ürünler ve bota ek talimat."
        footer={
          <div className="flex items-center justify-between gap-2">
            {editing && editing !== "new" ? <button type="button" className={danger} disabled={busy} onClick={() => setRemoving(editing)}>Sil</button> : <span />}
            <button type="button" className={primary} disabled={busy} onClick={() => void save()}>{busy ? "İşleniyor…" : editing === "new" ? "Ekle" : "Güncelle"}</button>
          </div>
        }>
        <div className="space-y-4">
          <Field id="ref-label" label="Ad" required error={errors.get("label")} hint="Yalnız panelde görünür.">
            <input id="ref-label" className={`${inputCls} h-10`} maxLength={120} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} aria-invalid={errors.has("label")} placeholder="Kış triko reklamı" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <Field id="ref-type" label="Kaynak" error={errors.get("sourceType")}>
              <select id="ref-type" className={`${inputCls} h-10`} value={form.sourceType} onChange={(e) => setForm((f) => ({ ...f, sourceType: e.target.value as ReferralType }))}>
                {REFERRAL_TYPE_KEYS.map((k) => <option key={k} value={k}>{REFERRAL_TYPES[k]}</option>)}
              </select>
            </Field>
            <Field id="ref-source" label="Kimlik / kod" required error={errors.get("sourceId")} hint={ID_HINT[form.sourceType]}>
              <input id="ref-source" autoComplete="off" className={`${inputCls} h-10`} maxLength={200} value={form.sourceId} onChange={(e) => setForm((f) => ({ ...f, sourceId: e.target.value }))} aria-invalid={errors.has("sourceId")} />
            </Field>
          </div>
          <OrderedPicker id="ref-products" label="Ürünler" options={products} value={form.productIds} max={MAX_REFERRAL_PRODUCTS} error={errors.get("productIds")} onChange={(productIds) => setForm((f) => ({ ...f, productIds }))} />
          <Field id="ref-prompt" label="Bu kaynaktan gelenler için ek talimat" error={errors.get("extraPrompt")} hint={<Counter value={form.extraPrompt} max={1000} />}>
            <textarea id="ref-prompt" rows={3} maxLength={1000} className={`${inputCls} py-2`} value={form.extraPrompt} onChange={(e) => setForm((f) => ({ ...f, extraPrompt: e.target.value }))} placeholder="Bu reklamdan gelene KIS10 indirim kodunu ver." />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="size-4 accent-[#7367f0]" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Eşlemeyi kullan
          </label>
        </div>
      </AdminDrawer>
      <AdminConfirmDialog open={removing !== null} title="Eşleme silinsin mi?" description={removing ? `“${removing.label}” silinir. Bu kaynaktan gelen müşterilerle bot artık belirli bir ürünle başlamaz.` : undefined}
        confirmLabel="Sil" busy={busy} onCancel={() => setRemoving(null)} onConfirm={() => void remove()} />
    </AdminCard>
  );
}
