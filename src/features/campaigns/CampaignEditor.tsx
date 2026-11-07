"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Save, Trash2, X } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Field, inputCls } from "@/components/admin/form";
import {
  BADGE_EMOJIS, CAMPAIGN_KINDS, CAMPAIGN_KIND_KEYS, CAMPAIGN_STAGES, CAMPAIGN_STATUSES, MAX_TIERS, badgeText, campaignStatus, valueLabel,
  type CampaignConditions, type CampaignDetail, type CampaignInput, type CampaignKind, type CampaignTargets,
} from "@/modules/campaigns/domain/campaign";
import { ImageUpload, type UploadedImage } from "@/features/media/ImageUpload";
import { campaignsApi } from "./api";
import { CouponsPanel } from "./CouponsPanel";
import { TargetPicker, type TargetOption } from "./TargetPicker";
import { isoToLocalInput, localInputToIso, minorToTl, tlToMinor } from "@/lib/form-values";

type Form = {
  name: string; kind: CampaignKind; percent: string; amount: string; buy: string; pay: string;
  targetMode: "all" | "selected"; targets: CampaignTargets; startsAt: string; endsAt: string;
  priority: string; stackPolicy: "exclusive" | "combinable"; minSubtotal: string; maxDiscount: string; capacity: string;
  requiresCoupon: boolean; isActive: boolean;
  tiers: { qty: string; percent: string }[]; conditions: CampaignConditions; conditionMin: string; firstOrderOnly: boolean;
  badgeLabel: string; badgeEmoji: string; badgeImage: UploadedImage | null;
};

const pctStr = (bps: number | null | undefined) => (bps != null ? String(bps / 100).replace(".", ",") : "");
const pctBps = (v: string) => (v.trim() ? Math.round(Number(v.replace(",", ".")) * 100) : null);

const fromDetail = (c: CampaignDetail | null, now: string): Form => ({
  name: c?.name ?? "", kind: c?.kind ?? "percentage",
  percent: c?.percentageBps != null ? String(c.percentageBps / 100).replace(".", ",") : "", amount: minorToTl(c?.amountMinor),
  buy: c?.buyQuantity != null ? String(c.buyQuantity) : "3", pay: c?.payQuantity != null ? String(c.payQuantity) : "2",
  targetMode: c?.targetMode ?? "all", targets: c?.targets ?? { products: [], brands: [], categories: [] },
  startsAt: isoToLocalInput(c?.startsAt ?? now), endsAt: isoToLocalInput(c?.endsAt),
  priority: String(c?.priority ?? 0), stackPolicy: c?.stackPolicy ?? "exclusive", minSubtotal: minorToTl(c?.minSubtotalMinor ?? 0) || "0",
  maxDiscount: minorToTl(c?.maxDiscountMinor), capacity: c?.capacityUnits != null ? String(c.capacityUnits) : "",
  requiresCoupon: c?.requiresCoupon ?? false, isActive: c?.isActive ?? false,
  tiers: c?.tiers.length ? c.tiers.map((t) => ({ qty: String(t.minQuantity), percent: pctStr(t.percentageBps) })) : [{ qty: "2", percent: "10" }, { qty: "3", percent: "20" }],
  conditions: c?.conditions ?? { products: [], brands: [], categories: [] }, conditionMin: String(c?.conditionMinQuantity ?? 1), firstOrderOnly: c?.firstOrderOnly ?? false,
  badgeLabel: c?.badgeLabel ?? "", badgeEmoji: c?.badgeEmoji ?? "", badgeImage: c?.badgeMediaId && c.badgeImageUrl ? { id: c.badgeMediaId, url: c.badgeImageUrl } : null,
});

function toInput(f: Form): CampaignInput {
  const int = (v: string) => (v.trim() ? Number(v) : null);
  const pct = pctBps(f.percent);
  return {
    name: f.name, kind: f.kind, percentageBps: pct, amountMinor: tlToMinor(f.amount), buyQuantity: int(f.buy), payQuantity: int(f.pay),
    targetMode: f.targetMode, targets: f.targets, startsAt: localInputToIso(f.startsAt) ?? new Date().toISOString(), endsAt: localInputToIso(f.endsAt),
    priority: Number(f.priority) || 0, stackPolicy: f.stackPolicy, minSubtotalMinor: tlToMinor(f.minSubtotal) ?? 0, maxDiscountMinor: tlToMinor(f.maxDiscount),
    capacityUnits: int(f.capacity), requiresCoupon: f.requiresCoupon, isActive: f.isActive,
    tiers: f.tiers.map((t) => ({ minQuantity: Number(t.qty) || 0, percentageBps: pctBps(t.percent) ?? 0 })),
    conditions: f.conditions, conditionMinQuantity: Number(f.conditionMin) || 1, firstOrderOnly: f.firstOrderOnly,
    badgeLabel: f.badgeLabel.trim() || null, badgeEmoji: f.badgeEmoji.trim() || null, badgeMediaId: f.badgeImage?.id ?? null,
  };
}

/** The storefront badge as shoppers will see it (cards, product page, cart). */
export function BadgePreview({ emoji, imageUrl, label }: { emoji: string | null; imageUrl: string | null; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-[#f21c99] px-2 py-0.5 text-[12px] font-bold text-white shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element -- R2 asset */}
      {imageUrl ? <img src={imageUrl} alt="" className="size-4 rounded-sm object-contain" /> : emoji ? <span aria-hidden>{emoji}</span> : null}
      <span className="truncate">{label}</span>
    </span>
  );
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
  const [badgeUploading, setBadgeUploading] = useState(false);
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
    const cond = f.kind === "cross_sell" ? `, koşul ürünlerinden ${input.conditionMinQuantity} adet alınınca` : "";
    return `${valueLabel(input)} — ${scope}${min}${cond}${f.requiresCoupon ? ", kupon koduyla" : ""}${f.firstOrderOnly ? ", yalnız ilk siparişte" : ""}`;
  }, [input, f.targetMode, f.requiresCoupon, f.kind, f.firstOrderOnly]);
  const stage = f.kind === "free_shipping" ? "shipping" : f.requiresCoupon ? "coupon" : CAMPAIGN_KINDS[f.kind].stage;
  const setTier = (i: number, p: Partial<Form["tiers"][number]>) => set({ tiers: f.tiers.map((t, j) => (j === i ? { ...t, ...p } : t)) });
  const asRefs = (ids: string[]) => ids.map((id) => ({ id, mode: "include" as const }));
  const status = campaignStatus({ isActive: f.isActive, startsAt: input.startsAt, endsAt: input.endsAt ?? null }, new Date().toISOString());

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || badgeUploading) return;
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

  const percentField = (label: string) => (
    <Field id="cm-pct" label={label} required error={fe("percentageBps")}><input id="cm-pct" inputMode="decimal" className={inputCls} value={f.percent} placeholder="20" onChange={(e) => set({ percent: e.target.value })} aria-invalid={!!fe("percentageBps")} /></Field>
  );
  const kindField = (kind: CampaignKind) => {
    switch (kind) {
      case "percentage":
      case "cart_percentage":
        return percentField(kind === "percentage" ? "İndirim oranı (%)" : "Sepet indirimi (%)");
      case "amount":
      case "fixed_price":
        return <Field id="cm-amt" label={kind === "amount" ? "İndirim tutarı (₺)" : "Ürün başı fiyat (₺)"} required error={fe("amountMinor")}><input id="cm-amt" inputMode="decimal" className={inputCls} value={f.amount} placeholder="50" onChange={(e) => set({ amount: e.target.value })} aria-invalid={!!fe("amountMinor")} /></Field>;
      case "buy_x_pay_y":
        return (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <Field id="cm-buy" label="Alınan adet (X)" required error={fe("buyQuantity")}><input id="cm-buy" type="number" min={2} className={inputCls} value={f.buy} onChange={(e) => set({ buy: e.target.value })} /></Field>
              <Field id="cm-pay" label="Ödenen adet (Y)" required error={fe("payQuantity")}><input id="cm-pay" type="number" min={1} className={inputCls} value={f.pay} onChange={(e) => set({ pay: e.target.value })} /></Field>
            </div>
            <p className="text-xs text-slate-500">Kapsamdaki ürünler pahalıdan ucuza sıralanır; her {f.buy || "X"} üründe en ucuz {Math.max(0, (Number(f.buy) || 0) - (Number(f.pay) || 0)) || "?"} tanesi bedavadır. “En ucuz ürün bedava” için Y = X − 1 girin.</p>
          </div>
        );
      case "tiered_quantity":
        return (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-600">Kademeler <span className="font-normal text-slate-500">— aynı üründen alınan adede göre her üründe indirim</span></p>
            <ul className="space-y-2">
              {f.tiers.map((t, i) => (
                <li key={i} className="flex items-end gap-2">
                  <Field id={`cm-tq-${i}`} label="En az adet" className="w-32"><input id={`cm-tq-${i}`} type="number" min={2} className={inputCls} value={t.qty} onChange={(e) => setTier(i, { qty: e.target.value })} /></Field>
                  <Field id={`cm-tp-${i}`} label="İndirim (%)" className="w-32"><input id={`cm-tp-${i}`} inputMode="decimal" className={inputCls} value={t.percent} onChange={(e) => setTier(i, { percent: e.target.value })} /></Field>
                  <button type="button" onClick={() => set({ tiers: f.tiers.filter((_, j) => j !== i) })} disabled={f.tiers.length <= 1} aria-label={`${i + 1}. kademeyi kaldır`}
                    className="mb-0.5 grid size-10 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"><X className="size-4" /></button>
                </li>
              ))}
            </ul>
            {fe("tiers") ? <p className="text-xs text-red-600">{fe("tiers")}</p> : null}
            <button type="button" disabled={f.tiers.length >= MAX_TIERS}
              onClick={() => set({ tiers: [...f.tiers, { qty: String((Number(f.tiers.at(-1)?.qty) || 1) + 1), percent: "" }] })}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"><Plus className="size-3.5" />Kademe ekle</button>
          </div>
        );
      case "cross_sell":
        return (
          <div className="space-y-4">
            {percentField("Kapsamdaki ürünlerde indirim (%)")}
            <div className="rounded-xl border border-dashed border-slate-300 p-4">
              <p className="text-sm font-medium text-slate-800">Koşul: sepette bulunması gerekenler</p>
              <p className="mb-3 text-xs text-slate-500">Örn. “Ayakkabı” kategorisinden 1 ürün alana, aşağıdaki Kapsam bölümünde seçtiğiniz bakım spreyleri indirimli olur.</p>
              {fe("conditions") ? <p className="mb-2 text-xs text-red-600">{fe("conditions")}</p> : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <TargetPicker id="cm-ccat" label="Koşul kategorileri" options={options.categories} value={asRefs(f.conditions.categories)} allowInclude includeOnly
                  onChange={(v) => set({ conditions: { ...f.conditions, categories: v.map((x) => x.id) } })} />
                <TargetPicker id="cm-cbrand" label="Koşul markaları" options={options.brands} value={asRefs(f.conditions.brands)} allowInclude includeOnly
                  onChange={(v) => set({ conditions: { ...f.conditions, brands: v.map((x) => x.id) } })} />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_180px]">
                <TargetPicker id="cm-cprod" label="Koşul ürünleri" options={options.products} value={asRefs(f.conditions.products)} allowInclude includeOnly
                  onChange={(v) => set({ conditions: { ...f.conditions, products: v.map((x) => x.id) } })} />
                <Field id="cm-cmin" label="En az adet" error={fe("conditionMinQuantity")}><input id="cm-cmin" type="number" min={1} max={100} className={inputCls} value={f.conditionMin} onChange={(e) => set({ conditionMin: e.target.value })} /></Field>
              </div>
            </div>
          </div>
        );
      case "free_shipping":
        return <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">Koşul sağlanınca (minimum sepet ve kapsamdaki en az bir ürün) kargo ücreti alınmaz.</p>;
    }
  };

  const groups = (["product", "cart", "shipping"] as const).map((g) => ({ stage: g, kinds: CAMPAIGN_KIND_KEYS.filter((k) => CAMPAIGN_KINDS[k].stage === g) }));
  const badgeLabelShown = badgeText({ ...input, badgeLabel: f.badgeLabel });

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
              <fieldset className="space-y-3">
                <legend className="mb-1 block text-xs font-medium text-slate-600">Kampanya türü</legend>
                {groups.map((g) => (
                  <div key={g.stage}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{CAMPAIGN_STAGES[g.stage].order}. {CAMPAIGN_STAGES[g.stage].label}</p>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {g.kinds.map((k) => (
                        <label key={k} className={`flex cursor-pointer flex-col rounded-xl border px-3 py-2.5 ${f.kind === k ? "border-[#7367f0] bg-[#7367f0]/5" : "border-slate-200 hover:bg-slate-50"}`}>
                          <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                            <input type="radio" name="kind" value={k} checked={f.kind === k} onChange={() => set({ kind: k })} className="accent-[#7367f0]" />{CAMPAIGN_KINDS[k].label}
                          </span>
                          <span className="mt-0.5 pl-5 text-xs text-slate-500">{CAMPAIGN_KINDS[k].hint}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
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
              <Field id="cm-min" label="Minimum sepet (₺)" error={fe("minSubtotalMinor")}
                hint={stage === "product" ? "İndirim öncesi sepet tutarı." : stage === "cart" ? "Ürün indirimleri düşüldükten sonraki tutar." : stage === "coupon" ? "Ürün ve sepet indirimlerinden sonraki tutar." : "Tüm indirimler düşüldükten sonraki tutar."}>
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
              <Field id="cm-prio" label="Öncelik" error={fe("priority")} hint="Büyük sayı önce uygulanır (aynı aşamadaki kampanyalar arasında).">
                <input id="cm-prio" type="number" className={inputCls} value={f.priority} onChange={(e) => set({ priority: e.target.value })} />
              </Field>
              <fieldset className="sm:col-span-2">
                <legend className="mb-1 block text-xs font-medium text-slate-600">Diğer kampanyalarla</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([["exclusive", "Birleşmez", "Uygulandığı ürüne başka kampanya uygulanmaz; zaten indirimli ürüne de uygulanmaz."], ["combinable", "Birleşir", "Birleşmeyen bir kampanyanın kilitlemediği ürünlerde diğer indirimlerin üstüne eklenir."]] as const).map(([v, l, h]) => (
                    <label key={v} className={`flex cursor-pointer gap-2 rounded-xl border px-3 py-2.5 ${f.stackPolicy === v ? "border-[#7367f0] bg-[#7367f0]/5" : "border-slate-200"}`}>
                      <input type="radio" name="stack" checked={f.stackPolicy === v} onChange={() => set({ stackPolicy: v })} className="mt-0.5 accent-[#7367f0]" />
                      <span><span className="block text-sm font-medium text-slate-800">{l}</span><span className="block text-xs text-slate-500">{h}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Vitrin rozeti" subtitle="Ürün kartında, ürün sayfasında ve sepette kampanyanın yanında görünür." />
            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-4">
                <fieldset>
                  <legend className="mb-1 block text-xs font-medium text-slate-600">Emoji</legend>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => set({ badgeEmoji: "" })} aria-pressed={!f.badgeEmoji}
                      className={`h-9 rounded-lg border px-2.5 text-xs font-medium ${!f.badgeEmoji ? "border-[#7367f0] bg-[#7367f0]/5 text-[#5b4fe0]" : "border-slate-200 text-slate-500"}`}>Yok</button>
                    {BADGE_EMOJIS.map((e) => (
                      <button key={e} type="button" onClick={() => set({ badgeEmoji: e })} aria-pressed={f.badgeEmoji === e} aria-label={`Emoji ${e}`}
                        className={`grid size-9 place-items-center rounded-lg border text-lg ${f.badgeEmoji === e ? "border-[#7367f0] bg-[#7367f0]/5" : "border-slate-200 hover:bg-slate-50"}`}>{e}</button>
                    ))}
                    <input aria-label="Başka emoji" className={`${inputCls} w-20 text-center`} value={BADGE_EMOJIS.includes(f.badgeEmoji as (typeof BADGE_EMOJIS)[number]) ? "" : f.badgeEmoji}
                      placeholder="✨" maxLength={8} onChange={(e) => set({ badgeEmoji: e.target.value })} />
                  </div>
                  {fe("badgeEmoji") ? <p className="mt-1 text-xs text-red-600">{fe("badgeEmoji")}</p> : null}
                </fieldset>
                <Field id="cm-blabel" label="Rozet metni" error={fe("badgeLabel")} hint={`Boş = “${valueLabel(input)}”`}>
                  <input id="cm-blabel" className={inputCls} value={f.badgeLabel} maxLength={40} placeholder={valueLabel(input)} onChange={(e) => set({ badgeLabel: e.target.value })} />
                </Field>
                <div className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Önizleme</p>
                  <BadgePreview emoji={f.badgeEmoji || null} imageUrl={f.badgeImage?.url ?? null} label={badgeLabelShown} />
                </div>
              </div>
              <ImageUpload label="Rozet görseli (isteğe bağlı)" hint="Kare, küçük bir ikon; emojinin yerine gösterilir." folder="campaigns" aspect="aspect-square"
                value={f.badgeImage} onChange={(badgeImage) => set({ badgeImage })} onUploadingChange={setBadgeUploading} error={fe("badgeMediaId")} />
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
                <span><span className="block text-sm font-medium text-slate-800">Yalnız ilk alışveriş</span><span className="block text-xs text-slate-500">Üye girişi yapmış, daha önce siparişi olmayan müşterilere.</span></span>
                <input type="checkbox" className="size-5 accent-[#7367f0]" checked={f.firstOrderOnly} onChange={(e) => set({ firstOrderOnly: e.target.checked })} />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3">
                <span><span className="block text-sm font-medium text-slate-800">Kupon kodu gereksin</span><span className="block text-xs text-slate-500">Yalnız kupon girenlere uygulanır.</span></span>
                <input type="checkbox" className="size-5 accent-[#7367f0]" checked={f.requiresCoupon} onChange={(e) => set({ requiresCoupon: e.target.checked })} />
              </label>
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Özet</p>
                <p className="mt-1">{summary}</p>
                <p className="mt-2 text-xs text-slate-500">Hesaplama aşaması: {CAMPAIGN_STAGES[stage].order}. {CAMPAIGN_STAGES[stage].label}</p>
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
            <button type="submit" disabled={saving || badgeUploading || (!!campaign && !dirty)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60">
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
