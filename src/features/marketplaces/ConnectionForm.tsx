"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Save } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { Field, inputCls } from "@/components/admin/form";
import { DEFAULT_SETTINGS, MARKETPLACES, MARKETPLACE_KEYS, SYNC_INTERVALS, type ConnectionIntervals, type ConnectionRow, type ConnectionSettings, type MarketplaceProvider } from "@/modules/marketplaces/domain/marketplace";
import { marketplacesApi } from "./api";

const DEFAULT_INTERVALS: ConnectionIntervals = { orders: 5, stock: 5, price: 15, content: 60 };
const minutesLabel = (m: number) => (m >= 60 ? `${m / 60} saat` : `${m} dakika`);
const INTERVAL_LABELS: Record<keyof ConnectionIntervals, string> = {
  orders: "Sipariş çekme", stock: "Stok gönderimi", price: "Fiyat gönderimi", content: "Ürün bilgisi & görsel",
};
const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** Create / edit a marketplace connection. Keys are write-only: empty fields on edit keep the stored keys. */
export function ConnectionForm({ initial }: { initial: ConnectionRow | null }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const [provider, setProvider] = useState<MarketplaceProvider>(initial?.provider ?? "trendyol");
  const [name, setName] = useState(initial?.name ?? "Trendyol");
  const [environment, setEnvironment] = useState<"production" | "stage">(initial?.environment ?? "production");
  const [sellerId, setSellerId] = useState(initial?.sellerId ?? "");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [s, setS] = useState<ConnectionSettings>(initial?.settings ?? DEFAULT_SETTINGS);
  const [intervals, setIntervals] = useState<ConnectionIntervals>(initial?.intervals ?? DEFAULT_INTERVALS);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ConnectionSettings>(k: K, v: ConnectionSettings[K]) => setS((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const input = { provider, name, environment, sellerId, apiKey: apiKey || null, apiSecret: apiSecret || null, settings: s, intervals, isActive, expectedUpdatedAt: initial?.updatedAt };
      if (initial) {
        await marketplacesApi.save(initial.id, input);
        notify.success("Bağlantı güncellendi");
        setApiKey(""); setApiSecret("");
        router.refresh();
      } else {
        const r = await marketplacesApi.create(input);
        notify.success("Bağlantı eklendi", { description: "Şimdi kategori ve marka eşleştirmesini yapın." });
        router.push(`/admin/entegrasyonlar/pazaryerleri/${r.data.id}`);
      }
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Bağlantı kaydedilemedi." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="grid gap-4 md:grid-cols-3">
        <Field id="mp-provider" label="Pazaryeri" required>
          <select id="mp-provider" className={`${inputCls} h-10`} value={provider} disabled={!!initial} onChange={(e) => setProvider(e.target.value as MarketplaceProvider)}>
            {MARKETPLACE_KEYS.map((k) => <option key={k} value={k} disabled={!MARKETPLACES[k].ready}>{MARKETPLACES[k].label}{MARKETPLACES[k].ready ? "" : " (yakında)"}</option>)}
          </select>
        </Field>
        <Field id="mp-name" label="Bağlantı adı" required error={errors.get("name")}>
          <input id="mp-name" className={`${inputCls} h-10`} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.has("name")} />
        </Field>
        <Field id="mp-env" label="Ortam" hint="Test ortamı (stage) için Trendyol'a IP yetkilendirmesi gerekir.">
          <select id="mp-env" className={`${inputCls} h-10`} value={environment} onChange={(e) => setEnvironment(e.target.value as "production" | "stage")}>
            <option value="production">Canlı (apigw.trendyol.com)</option>
            <option value="stage">Test (stageapigw.trendyol.com)</option>
          </select>
        </Field>
        <Field id="mp-seller" label="Satıcı ID (Supplier ID)" required error={errors.get("sellerId")}>
          <input id="mp-seller" inputMode="numeric" className={`${inputCls} h-10 font-mono`} value={sellerId} onChange={(e) => setSellerId(e.target.value)} aria-invalid={errors.has("sellerId")} />
        </Field>
        <Field id="mp-key" label="API Key" required={!initial} error={errors.get("apiKey")} hint={initial ? "Değiştirmeyecekseniz boş bırakın." : "Şifrelenerek saklanır."}>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="mp-key" type="password" autoComplete="off" className={`${inputCls} h-10 pl-9 font-mono`} value={apiKey} placeholder={initial ? "••••••••" : ""} onChange={(e) => setApiKey(e.target.value)} />
          </div>
        </Field>
        <Field id="mp-secret" label="API Secret" required={!initial} error={errors.get("apiSecret")}>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="mp-secret" type="password" autoComplete="off" className={`${inputCls} h-10 pl-9 font-mono`} value={apiSecret} placeholder={initial ? "••••••••" : ""} onChange={(e) => setApiSecret(e.target.value)} />
          </div>
        </Field>
      </div>

      <fieldset className="grid gap-4 border-t border-slate-100 pt-4 md:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-800">Gönderim kuralları</legend>
        <Field id="mp-cargo" label="Kargo firması ID" hint="Trendyol kargo firma kimliği (ör. Yurtiçi 17, Aras 10, MNG 6). Ürün oluşturmak için zorunlu.">
          <input id="mp-cargo" inputMode="numeric" className={`${inputCls} h-10`} value={s.cargoCompanyId ?? ""} onChange={(e) => set("cargoCompanyId", num(e.target.value))} />
        </Field>
        <Field id="mp-days" label="Kargoya teslim süresi (gün)">
          <input id="mp-days" type="number" min={0} max={30} className={`${inputCls} h-10`} value={s.deliveryDuration} onChange={(e) => set("deliveryDuration", Number(e.target.value) || 0)} />
        </Field>
        <Field id="mp-pct" label="Fiyat farkı (%)" hint="Komisyonu karşılamak için mağaza fiyatına eklenir (eksi değer indirim).">
          <input id="mp-pct" type="number" step="0.5" min={-50} max={300} className={`${inputCls} h-10`} value={s.priceAdjustPct} onChange={(e) => set("priceAdjustPct", Number(e.target.value) || 0)} />
        </Field>
        <Field id="mp-buffer" label="Güvenlik stoğu (adet)" hint="Bu kadar adet pazaryerine gösterilmez.">
          <input id="mp-buffer" type="number" min={0} className={`${inputCls} h-10`} value={s.stockBuffer} onChange={(e) => set("stockBuffer", Number(e.target.value) || 0)} />
        </Field>
        <Field id="mp-ship" label="Sevkiyat adres ID (ops.)">
          <input id="mp-ship" inputMode="numeric" className={`${inputCls} h-10`} value={s.shipmentAddressId ?? ""} onChange={(e) => set("shipmentAddressId", num(e.target.value))} />
        </Field>
        <Field id="mp-ret" label="İade adres ID (ops.)">
          <input id="mp-ret" inputMode="numeric" className={`${inputCls} h-10`} value={s.returningAddressId ?? ""} onChange={(e) => set("returningAddressId", num(e.target.value))} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-3">
          <input type="checkbox" checked={s.useCompareAtAsListPrice} onChange={(e) => set("useCompareAtAsListPrice", e.target.checked)} />
          Üstü çizili fiyatı Trendyol&apos;da &quot;piyasa satış fiyatı&quot; (listPrice) olarak gönder
        </label>
      </fieldset>

      <fieldset className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold text-slate-800">Senkron aralıkları</legend>
        {(Object.keys(INTERVAL_LABELS) as (keyof ConnectionIntervals)[]).map((k) => (
          <Field key={k} id={`mp-int-${k}`} label={INTERVAL_LABELS[k]}>
            <select id={`mp-int-${k}`} className={`${inputCls} h-10`} value={intervals[k]} onChange={(e) => setIntervals((p) => ({ ...p, [k]: Number(e.target.value) }))}>
              {SYNC_INTERVALS[k].map((m) => <option key={m} value={m}>Her {minutesLabel(m)}</option>)}
            </select>
          </Field>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Otomatik senkron açık
        </label>
        <button type="submit" disabled={saving}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60">
          <Save className="h-4 w-4" /> {saving ? "Kaydediliyor…" : initial ? "Kaydet" : "Bağlantıyı ekle"}
        </button>
      </div>
    </form>
  );
}
