"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Plus, Trash2, Truck } from "lucide-react";
import { formatMinor } from "@/lib/money";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import type { ShippingRateView } from "@/modules/shipping";
import { shippingRatesApi } from "./api";

const btn = "inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";
const primary = "inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60";

/** "39,90" / "39.90" / "1.250,00" → 3990 kuruş; empty → null; anything else → NaN. */
function parseTl(v: string): number | null {
  const s = v.trim().replace(/\s|₺/g, "");
  if (!s) return null;
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^\d+(\.\d{1,2})?$/.test(normal) ? Math.round(Number(normal) * 100) : Number.NaN;
}
const tl = (minor: number | null) => (minor == null ? "" : (minor / 100).toFixed(2).replace(".", ","));

type Form = { name: string; fee: string; freeAbove: string; isActive: boolean };
const empty: Form = { name: "", fee: "", freeAbove: "", isActive: true };

/**
 * Kargo ücretleri: the shipping fee checkout adds and the order total above which shipping is free. Checkout uses
 * the cheapest active method; at least one stays active, methods used by shipments can only be deactivated.
 */
export function ShippingRatesManager({ rates }: { rates: ShippingRateView[] }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const [editing, setEditing] = useState<ShippingRateView | "new" | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<ShippingRateView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const applied = rates.filter((r) => r.isActive).sort((a, b) => a.feeMinor - b.feeMinor)[0];

  const open = (r: ShippingRateView | "new") => {
    errors.clear();
    setForm(r === "new" ? empty : { name: r.name, fee: tl(r.feeMinor), freeAbove: tl(r.freeAboveMinor), isActive: r.isActive });
    setEditing(r);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !editing) return;
    errors.clear();
    const feeMinor = parseTl(form.fee);
    const freeAboveMinor = parseTl(form.freeAbove);
    if (feeMinor == null || Number.isNaN(feeMinor)) { errors.set({ feeMinor: ["Ücreti 39,90 biçiminde girin (ücretsiz için 0)."] }); return; }
    if (Number.isNaN(freeAboveMinor) || freeAboveMinor === 0) { errors.set({ freeAboveMinor: ["Tutarı 500,00 biçiminde girin ya da boş bırakın."] }); return; }
    setSaving(true);
    const input = { name: form.name, feeMinor, freeAboveMinor, isActive: form.isActive, expectedUpdatedAt: editing === "new" ? null : editing.updatedAt };
    try {
      if (editing === "new") await shippingRatesApi.create(input);
      else await shippingRatesApi.update(editing.id, input);
      notify.success(editing === "new" ? "Kargo ücreti eklendi" : "Kargo ücreti güncellendi");
      setEditing(null);
      router.refresh();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Kargo ücreti kaydedilemedi." });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setDeleting(true);
    try {
      await shippingRatesApi.remove(removing.id);
      notify.success("Kargo ücreti silindi");
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "Kargo ücreti silinemedi." });
    } finally {
      setDeleting(false);
      setRemoving(null);
    }
  };

  const set = (k: "name" | "fee" | "freeAbove") => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    errors.clear(k === "fee" ? "feeMinor" : k === "freeAbove" ? "freeAboveMinor" : k);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Kargo ücretleri" subtitle="Ödeme sayfasında siparişe eklenen kargo ücreti ve ücretsiz kargo eşiği." />
      <AdminCard className="max-w-4xl">
        <AdminCardTitle title="Kargo yöntemleri"
          subtitle={applied ? `Şu an uygulanan: ${applied.name} · ${applied.feeMinor ? formatMinor(applied.feeMinor) : "Ücretsiz"}${applied.freeAboveMinor ? ` · ${formatMinor(applied.freeAboveMinor)} üzeri ücretsiz` : ""}` : "Aktif kargo yöntemi yok."}
          actions={<button type="button" onClick={() => open("new")} className={btn}><Plus className="h-4 w-4" /> Yöntem ekle</button>} />
        <div className="px-5 py-5">
          {rates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
              <Truck className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm text-slate-600">Henüz kargo yöntemi yok. Ödeme sayfası kargo ücreti almaz.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {rates.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                      {r.name}
                      {applied?.id === r.id && <AdminBadge tone="green">Ödemede uygulanıyor</AdminBadge>}
                      {!r.isActive && <AdminBadge>Pasif</AdminBadge>}
                      {r.inUse && <AdminBadge tone="blue">Gönderilerde kullanıldı</AdminBadge>}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {r.feeMinor ? formatMinor(r.feeMinor) : "Ücretsiz"}
                      {r.freeAboveMinor ? <span className="text-slate-500"> · {formatMinor(r.freeAboveMinor)} ve üzeri siparişlerde ücretsiz</span> : null}
                    </p>
                  </div>
                  <div className="flex flex-none gap-1">
                    <button type="button" onClick={() => open(r)} className={btn} aria-label={`${r.name} yöntemini düzenle`}><Pencil className="h-4 w-4" /> Düzenle</button>
                    {!r.inUse && (
                      <button type="button" onClick={() => setRemoving(r)} aria-label={`${r.name} yöntemini sil`}
                        className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-slate-500">Birden çok aktif yöntem varsa ödemede en düşük ücretli olan uygulanır. Kampanyalardaki “ücretsiz kargo” bu ücretin yerine geçer.</p>
        </div>
      </AdminCard>

      <AdminDrawer open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Kargo yöntemi ekle" : "Kargo yöntemini güncelle"}
        subtitle="Tutarlar KDV dahil, Türk lirası."
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className={btn}>Vazgeç</button>
            <button type="submit" form="shipping-rate-form" disabled={saving} className={primary}>
              <Truck className="h-4 w-4" />
              {saving ? (editing === "new" ? "Ekleniyor…" : "Güncelleniyor…") : editing === "new" ? "Yöntemi ekle" : "Güncelle"}
            </button>
          </div>
        }>
        <form id="shipping-rate-form" onSubmit={save} noValidate className="space-y-4">
          <Field id="sr-name" label="Görünen ad" required error={errors.get("name")}>
            <input id="sr-name" className={`${inputCls} h-10`} value={form.name} maxLength={60} placeholder="Ör. Standart teslimat" onChange={set("name")} aria-invalid={errors.has("name")} />
          </Field>
          <Field id="sr-fee" label="Kargo ücreti (₺)" required error={errors.get("feeMinor")} hint="Ücretsiz kargo için 0 yazın.">
            <input id="sr-fee" inputMode="decimal" className={`${inputCls} h-10 tabular-nums`} value={form.fee} placeholder="39,90" onChange={set("fee")} aria-invalid={errors.has("feeMinor")} />
          </Field>
          <Field id="sr-free" label="Ücretsiz kargo eşiği (₺)" error={errors.get("freeAboveMinor")} hint="Sepet bu tutara ulaşınca kargo ücretsiz olur. Boş bırakırsanız hep ücret alınır.">
            <input id="sr-free" inputMode="decimal" className={`${inputCls} h-10 tabular-nums`} value={form.freeAbove} placeholder="500,00" onChange={set("freeAbove")} aria-invalid={errors.has("freeAboveMinor")} />
          </Field>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" className="size-4 accent-[#7367f0]" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Aktif — ödeme sayfasında kullanılabilir
          </label>
        </form>
      </AdminDrawer>

      <AdminConfirmDialog open={removing !== null} title="Kargo yöntemi silinsin mi?"
        description={removing ? `${removing.name} kalıcı olarak silinecek.` : ""}
        confirmLabel="Evet, sil" busyLabel="Siliniyor…" busy={deleting} onConfirm={remove} onCancel={() => setRemoving(null)} />
    </div>
  );
}
