"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { Modal } from "@/features/shop/ui/Modal";
import type { AddressInput, AddressView } from "@/modules/addresses";
import { MAX_ADDRESSES } from "@/modules/addresses/domain/address";
import { PhoneField } from "@/features/geo/PhoneField";
import { RegionFields } from "@/features/geo/RegionFields";
import { addressesApi } from "./api";

const empty: AddressInput = { label: "Ev", recipientName: "", phone: "", countryCode: "TR", province: "", district: "", line1: "", line2: null, postalCode: null, isDefaultShipping: false, isDefaultBilling: false };

/**
 * Hesabım › Adreslerim: saved delivery / billing addresses (add, edit, delete, defaults). Checkout offers them, so a
 * signed-in customer never types an address twice; placed orders keep their own copy.
 */
export function AddressBook({ addresses }: { addresses: AddressView[] }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const [editing, setEditing] = useState<AddressView | "new" | null>(null);
  const [form, setForm] = useState<AddressInput>(empty);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  // phone / region pickers keep their own state: remount them for each address opened
  const formKey = editing === "new" ? "new" : editing?.id ?? "none";

  const open = (a: AddressView | "new") => {
    errors.clear();
    setForm(a === "new" ? { ...empty, isDefaultShipping: addresses.length === 0, isDefaultBilling: addresses.length === 0 } : {
      label: a.label, recipientName: a.recipientName, phone: a.phone, countryCode: a.countryCode, province: a.province, district: a.district, line1: a.line1,
      line2: a.line2, postalCode: a.postalCode, isDefaultShipping: a.isDefaultShipping, isDefaultBilling: a.isDefaultBilling,
    });
    setEditing(a);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !editing) return;
    setBusy(true);
    errors.clear();
    try {
      if (editing === "new") await addressesApi.create(form);
      else await addressesApi.update(editing.id, form);
      notify.success(editing === "new" ? "Adres eklendi" : "Adres güncellendi");
      setEditing(null);
      router.refresh();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Adres kaydedilemedi." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setRemoving(id);
    try {
      await addressesApi.remove(id);
      notify.success("Adres silindi");
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "Adres silinemedi." });
    } finally {
      setRemoving(null);
    }
  };

  const field = (k: "label" | "recipientName" | "line1" | "postalCode", label: string, auto: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`ad-${k}`} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={`ad-${k}`} className="input" autoComplete={auto} value={form[k] ?? ""} aria-invalid={errors.has(k)} {...extra}
        onChange={(e) => { setForm((f) => ({ ...f, [k]: e.target.value })); errors.clear(k); }} />
      {errors.get(k) && <p className="mt-1 text-xs text-danger">{errors.get(k)}</p>}
    </div>
  );

  return (
    <section className="card p-5" aria-labelledby="addresses-title">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="addresses-title" className="text-lg font-semibold">Adreslerim</h2>
        {addresses.length < MAX_ADDRESSES && (
          <button type="button" onClick={() => open("new")} className="btn btn-ghost h-10 min-h-0 rounded-full px-4"><Plus className="size-4" /> Adres ekle</button>
        )}
      </div>
      {addresses.length === 0 ? (
        <div className="rounded-xl bg-ground px-5 py-8 text-center">
          <MapPin className="mx-auto size-8 text-muted" aria-hidden />
          <p className="mt-2 text-sm text-ink-soft">Kayıtlı adresiniz yok. Adres eklerseniz ödeme sayfasında tek dokunuşla seçebilirsiniz.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {addresses.map((a) => (
            <li key={a.id} className="flex flex-col rounded-2xl border border-line p-4">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                {a.label}
                {a.isDefaultShipping && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand-dark">Teslimat</span>}
                {a.isDefaultBilling && <span className="rounded-full bg-ground px-2 py-0.5 text-[11px] font-bold text-ink-soft">Fatura</span>}
              </p>
              <p className="mt-1 text-sm">{a.recipientName} · {a.phone}</p>
              <p className="mt-1 flex-1 text-sm text-ink-soft">{a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.district} / {a.province}</p>
              <div className="mt-3 flex gap-1">
                <button type="button" onClick={() => open(a)} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold hover:bg-ground" aria-label={`${a.label} adresini düzenle`}><Pencil className="size-4" /> Düzenle</button>
                <button type="button" disabled={removing === a.id} onClick={() => remove(a.id)} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-danger hover:bg-red-50 disabled:opacity-50" aria-label={`${a.label} adresini sil`}><Trash2 className="size-4" /> Sil</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Adres ekle" : "Adresi güncelle"} labelledBy="address-modal-title">
        <form onSubmit={save} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {field("label", "Adres adı", "off", { placeholder: "Ev, İş …", maxLength: 40 })}
            {field("recipientName", "Ad soyad", "name", { maxLength: 120 })}
            <PhoneField key={`p-${formKey}`} id="ad-phone" label="Cep telefonu" defaultValue={form.phone} defaultCountry={form.countryCode} error={errors.get("phone")}
              onChange={(phone, phoneCountry) => { setForm((f) => ({ ...f, phone, phoneCountry })); errors.clear("phone"); }} />
            {field("postalCode", "Posta kodu", "postal-code", { maxLength: 10 })}
            <RegionFields key={`r-${formKey}`} id="ad" defaultValue={form}
              errors={{ countryCode: errors.get("countryCode"), province: errors.get("province"), district: errors.get("district") }}
              onChange={(r) => { setForm((f) => ({ ...f, ...r })); errors.clear("province"); errors.clear("district"); }} />
          </div>
          {field("line1", "Açık adres", "street-address", { maxLength: 250 })}
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand" checked={form.isDefaultShipping} onChange={(e) => setForm((f) => ({ ...f, isDefaultShipping: e.target.checked }))} /> Varsayılan teslimat adresim</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand" checked={form.isDefaultBilling} onChange={(e) => setForm((f) => ({ ...f, isDefaultBilling: e.target.checked }))} /> Varsayılan fatura adresim</label>
          </div>
          <button className="btn btn-primary h-12 w-full rounded-full" disabled={busy}>{busy ? (editing === "new" ? "Ekleniyor…" : "Güncelleniyor…") : editing === "new" ? "Adresi ekle" : "Güncelle"}</button>
        </form>
      </Modal>
    </section>
  );
}
