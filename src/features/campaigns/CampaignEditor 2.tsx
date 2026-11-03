"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Field, inputCls } from "@/components/admin/form";
import {
  CAMPAIGN_KINDS, CAMPAIGN_KIND_KEYS, CAMPAIGN_STATUSES, campaignStatus, valueLabel,
  type CampaignDetail, type CampaignInput, type CampaignKind, type CampaignTargets,
} from "@/modules/campaigns/domain/campaign";
import { campaignsApi } from "./api";
import { CouponsPanel } from "./CouponsPanel";
import { TargetPicker, type TargetOption } from "./TargetPicker";
import { isoToLocalInput, localInputToIso, minorToTl, tlToMinor } from "@/lib/form-values";

type Form = {
  name: string; kind: CampaignKind; percent: string; amount: string; buy: string; pay: string;
  targetMode: "all" | "selected"; targets: CampaignTargets; startsAt: string; endsAt: string;
  priority: string; stackPolicy: "exclusive" | "combinable"; minSubtotal: string; maxDiscount: string; capacity: string;
  requiresCoupon: boolean; isActive: boolean;
};

const fromDetail = (c: CampaignDetail | null, now: string): Form => ({
  name: c?.name ?? "", kind: c?.kind ?? "percentage",
  percent: c?.percentageBps != null ? String(c.percentageBps / 100).replace(".", ",") : "", amount: minorToTl(c?.amountMinor),
  buy: c?.buyQuantity != null ? String(c.buyQuantity) : "3", pay: c?.payQuantity != null ? String(c.payQuantity) : "2",
  targetMode: c?.targetMode ?? "all", targets: c?.targets ?? { products: [], brands: [], categories: [] },
  startsAt: isoToLocalInput(c?.startsAt ?? now), endsAt: isoToLocalInput(c?.endsAt),
  priority: String(c?.priority ?? 0), stackPolicy: c?.stackPolicy ?? "exclusive", minSubtotal: minorToTl(c?.minSubtotalMinor ?? 0) || "0",
  maxDiscount: minorToTl(c?.maxDiscountMinor), capacity: c?.capacityUnits != null ? String(c.capacityUnits) : "",
  requiresCoupon: c?.requiresCoupon ?? false, isActive: c?.isActive ?? false,
});

function toInput(f: Form): CampaignInput {
  const int = (v: string) => (v.trim() ? Number(v) : null);
  const pct = f.percent.trim() ? Math.round(Number(f.percent.replace(",", ".")) * 100) : null;
  return {
    name: f.name, kind: f.kind, percentageBps: pct, amountMinor: tlToMinor(f.amount), buyQuantity: int(f.buy), payQuantity: int(f.pay),
    targetMode: f.targetMode, targets: f.targets, startsAt: localInputToIso(f.startsAt) ?? new Date().toISOString(), endsAt: localInputToIso(f.endsAt),
    priority: Number(f.priority) || 0, stackPolicy: f.stackPolicy, minSubtotalMinor: tlToMinor(f.minSubtotal) ?? 0, maxDiscountMinor: tlToMinor(f.maxDiscount),
    capacityUnits: int(f.capacity), requiresCoupon: f.requiresCoupon, isActive: f.isActive,
  };
}

/** Campaign editor: what (kind + value), for which products, when, under which conditions; coupons once saved. */
export function CampaignEditor({ campaign, options, now }: {
  campaign: CampaignDetail | null;
  options: { products: TargetOption[]; brands: TargetOption[]; categories: TargetOption[] };
  now: string;
}) {
  const router = useRouter();
  const [initial] = useState(() => fromDetail(campaign, now));
  const [f, setF] = useState<Form>(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const errors = useFieldErrors();
  const fe = errors.get;
  const set = (p: Partial<Form>) => setF((s) => ({ ...s, ...p }));
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  useEffect(() => {
    if (!dirty || saving) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, saving]);

  const input = toInput(f);
  const summary = useMemo(() => {
    const scope = f.targetMode === "all" ? "tüm ürünlerde" : "seçili ürünlerde";
    const min = input.minSubtotalMinor ? `, sepet ₺${minorToTl(input.minSubtotalMinor)} ve üzeri` : "";
    return `${valueLabel(input)} — ${scope}${min}${f.requiresCoupon ? ", kupon koduyla" : ""}`;
  }, [input, f.targetMode, f.requiresCoupon]);
  const status = campaignStatus({ isActive: f.isActive, startsAt: input.startsAt, endsAt: input.endsAt ?? null }, new Date().toISOString());

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    errors.clear();
    try {
      const id = campaign
        ? (await campaignsApi.update(campaign.id, { ...input, expectedUpdatedAt: campaign.updatedAt }), campaign.id)
        : (await campaignsApi.create(input)).data.id;
      router.push(campaign ? `/admin/kampanyalar?vurgula=${encodeURIComponent(id)}` : `/admin/kampanyalar/${id}?yeni=1`);
      router.refresh();
    } catch (err) {
      const n = errors.fromError(err);
      notify.error(err, { description: n ? "İşaretli alanları kontrol edin." : undefined });
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!campaign) return;
    try {
      await campaignsApi.remove(campaign.id);
      notify.success("Kampanya silindi", { description: campaign.name });
      router.push("/admin/kampanyalar");
      router.refresh();
    } catch (err) {
      notify.error(err);
      setConfirmDelete(false);
    }
  };

  const kindField = (kind: CampaignKind) => {
    switch (kind) {
      case "percentage":
        return <Field id="cm-pct" label="İndirim oranı (%)" required error={fe("percentageBps")}><input id="cm-pct" inputMode="decimal" className={inputCls} value={f.percent} placeholder="20" onChange={(e) => set({ percent: e.target.value })} aria-invalid={!!fe("percentageBps")} /></Field>;
      case "amount":
      case "fixed_price":
        return <Field id="cm-amt" label={kind === "amount" ? "İndirim tutarı (₺)" : "Ürün başı fiyat (₺)"} required error={fe("amountMinor")}><input id="cm-amt" inputMode="decimal" className={inputCls} value={f.amount} placeholder="50" onChange={(e) => set({ amount: e.target.value })} aria-invalid={!!fe("amountMinor")} /></Field>;
      case "buy_x_pay_y":
        return (
          <div className="grid grid-cols-2 gap-3">
            <Field id="cm-buy" label="Alınan adet (X)" required error={fe("buyQuantity")}><input id="cm-buy" type="number" min={2} className={inputCls} value={f.buy} onChange={(e) => set({ buy: e.target.value })} /></Field>
            <Field id="cm-pay" label="Ödenen adet (Y)" required error={fe("payQuantity")}><input id="cm-pay" type="number" min={1} className={inputCls} value={f.pay} onChange={(e) => set({ pay: e.target.value })} /></Field>
          </div>
        );
      case "free_shipping":
        return <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">Koşul sağlanınca (minimum sepet ve kapsamdaki en az bir ürün) kargo ücreti alınmaz.</p>;
    }
  };

  return (
    <form onSubmit={save} noValidate className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/kampanyalar" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" />Kampanyalar</Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{campaign ? campaign.name : "Yeni kampanya"}</h1>
            <AdminBadge tone={CAMPAIGN_STATUSES[status].tone}>{CAMPAIGN_STATUSES[status].label}</AdminBadge>
          </div>
          {campaign ? <p className="mt-1 text-sm text-slate-500">{campaign.orderCount} siparişte kullanıldı · ₺{minorToTl(campaign.discountMinor)} indirim verildi · kural sürümü {campaign.ruleVersion}</p> : null}
        </div>
        {campaign ? (
          <button type="button" onClick={() => setConfirmDelete(true)} disabled={campaign.orderCount > 0}
            title={campaign.orderCount > 0 ? "Siparişlerde kullanıldı; pasif yapın." : undefined}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
            <Trash2 className="size-4" />Sil
          </button>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <AdminCard>
            <AdminCardTitle title="İndirim" />
            <div className="space-y-4 p-5">
              <Field id="cm-name" label="Kampanya adı" required error={fe("name")} hint="Sepette ve siparişte indirim satırında görünür.">
                <input id="cm-name" className={inputCls} value={f.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!fe("name")} />
              </Field>
              <fieldset>
                <legend className="mb-1 block text-xs font-medium text-slate-600">Kampanya türü</legend>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {CAMPAIGN_KIND_KEYS.map((k) => (
                    <label key={k} className={`flex cursor-pointer flex-col rounded-xl border px-3 py-2.5 ${f.kind === k ? "border-[#7367f0] bg-[#7367f0]/5" : "border-slate-200 hover:bg-slate-50"}`}>
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        <input type="radio" name="kind" value={k} checked={f.kind === k} onChange={() => set({ kind: k })} className="accent-[#7367f0]" />{CAMPAIGN_KINDS[k].label}
                      </span>
                      <span className="mt-0.5 pl-5 text-xs text-slate-500">{CAMPAIGN_KINDS[k].hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {kindField(f.kind)}
            </div>
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Kapsam" subtitle="Kategori seçimi alt kategorileri de kapsar. Hariç tutulanlar her zaman önceliklidir." />
            <div className="space-y-4 p-5">
              <div role="radiogroup" aria-label="Kapsam" className="inline-flex rounded-lg bg-slate-100 p-0.5">
                {(["all", "selected"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={f.targetMode === m} onClick={() => set({ targetMode: m })}
                    className={`h-8 rounded-md px-3 text-sm font-medium ${f.targetMode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>
                    {m === "all" ? "Tüm ürünler" : "Seçili ürün / marka / kategori"}
                  </button>
                ))}
              </div>
              {fe("targets") ? <p className="text-xs text-red-600">{fe("targets")}</p> : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <TargetPicker id="cm-cat" label="Kategoriler" options={options.categories} value={f.targets.categories} allowInclude={f.targetMode === "selected"}
                  onChange={(categories) => set({ targets: { ...f.targets, categories } })} />
                <TargetPicker id="cm-brand" label="Markalar" options={options.brands} value={f.targets.brands} allowInclude={f.targetMode === "selected"}
                  onChange={(brands) => set({ targets: { ...f.targets, brands } })} />
              </div>
              <TargetPicker id="cm-prod" label="Ürünler" options={options.products} value={f.targets.products} allowInclude={f.targetMode === "selected"}
                onChange={(products) => set({ targets: { ...f.targets, products } })} />
            </div>
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Koşullar" />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field id="cm-min" label="Minimum sepet (₺)" error={fe("minSubtotalMinor")} hint={f.kind === "free_shipping" ? "İndirimler düşüldükten sonraki tutar." : "İndirim öncesi sepet tutarı."}>
                <input id="cm-min" inputMode="decimal" className={inputCls} value={f.minSubtotal} onChange={(e) => set({ minSubtotal: e.target.value })} />
              </Field>
              {f.kind !== "free_shipping" ? (
                <Field id="cm-max" label="En fazla indirim (₺)" error={fe("maxDiscountMinor")} hint="Boş = sınırsız.">
                  <input id="cm-max" inputMode="decimal" className={inputCls} value={f.maxDiscount} onChange={(e) => set({ maxDiscount: e.target.value })} />
                </Field>
              ) : null}
              <Field id="cm-cap" label="Toplam kapasite (adet)" error={fe("capacityUnits")} hint={campaign?.capacityUnits ? `${campaign.capacityUsed} kullanıldı. Boş = sınırsız.` : "Kampanyadan en fazla kaç ürün satılır. Boş = sınırsız."}>
                <input id="cm-cap" type="number" min={1} className={inputCls} value={f.capacity} onChange={(e) => set({ capacity: e.target.value })} />
              </Field>
              <Field id="cm-prio" label="Öncelik" error={fe("priority")} hint="Aynı ürüne birden çok kampanya uyarsa yüksek olan önce uygulanır.">
                <input id="cm-prio" type="number" className={inputCls} value={f.priority} onChange={(e) => set({ priority: e.target.value })} />
              </Field>
              <fieldset className="sm:col-span-2">
                <legend className="mb-1 block text-xs font-medium text-slate-600">Diğer kampanyalarla</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([["exclusive", "Birleşmez", "Bir ürüne bu veya daha iyi olan tek kampanya uygulanır."], ["combinable", "Birleşir", "Diğer indirimlerin üstüne eklenir."]] as const).map(([v, l, h]) => (
                    <label key={v} className={`flex cursor-pointer gap-2 rounded-xl border px-3 py-2.5 ${f.stackPolicy === v ? "border-[#7367f0] bg-[#7367f0]/5" : "border-slate-200"}`}>
                      <input type="radio" name="stack" checked={f.stackPolicy === v} onChange={() => set({ stackPolicy: v })} className="mt-0.5 accent-[#7367f0]" />
                      <span><span className="block text-sm font-medium text-slate-800">{l}</span><span className="block text-xs text-slate-500">{h}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </AdminCard>

          {campaign ? <CouponsPanel campaign={campaign} /> : (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">Kupon kodlarını kampanyayı oluşturduktan sonra ekleyebilirsiniz.</p>
          )}
        </div>

        <div className="space-y-6 xl:sticky xl:top-20 xl:self-start">
          <AdminCard>
            <AdminCardTitle title="Yayın" />
            <div className="space-y-4 p-5">
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                <span><span className="block text-sm font-medium text-slate-800">Aktif</span><span className="block text-xs text-slate-500">Kapalıyken tarih gelse de uygulanmaz.</span></span>
                <input type="checkbox" className="size-5 accent-[#7367f0]" checked={f.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
              </label>
              <Field id="cm-start" label="Başlangıç" required error={fe("startsAt")}>
                <input id="cm-start" type="datetime-local" className={inputCls} value={f.startsAt} onChange={(e) => set({ startsAt: e.target.value })} />
              </Field>
              <Field id="cm-end" label="Bitiş" error={fe("endsAt")} hint="Boş = süresiz. Saatler İstanbul saatidir.">
                <input id="cm-end" type="datetime-local" className={inputCls} value={f.endsAt} onChange={(e) => set({ endsAt: e.target.value })} aria-invalid={!!fe("endsAt")} />
              </Field>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                <span><span className="block text-sm font-medium text-slate-800">Kupon kodu gereksin</span><span className="block text-xs text-slate-500">Yalnız kupon girenlere uygulanır.</span></span>
                <input type="checkbox" className="size-5 accent-[#7367f0]" checked={f.requiresCoupon} onChange={(e) => set({ requiresCoupon: e.target.checked })} />
              </label>
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Özet</p>
                <p className="mt-1">{summary}</p>
              </div>
            </div>
          </AdminCard>
        </div>
      </div>

      <div className="sticky bottom-4 z-30">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <p className="text-sm text-slate-500">{dirty ? "Kaydedilmemiş değişiklikler var." : "Değişiklik yok."}</p>
          <div className="flex gap-2">
            <Link href="/admin/kampanyalar" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Vazgeç</Link>
            <button type="submit" disabled={saving || (!!campaign && !dirty)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60">
              <Save className="size-4" />{saving ? "Bekleyin…" : campaign ? "Güncelle" : "Kampanyayı oluştur"}
            </button>
          </div>
        </div>
      </div>

      <AdminConfirmDialog open={confirmDelete} title="Kampanya silinsin mi?" description={campaign ? `“${campaign.name}” ve kupon kodları kalıcı olarak silinecek.` : undefined}
        confirmLabel="Evet, sil" onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
    </form>
  );
}
