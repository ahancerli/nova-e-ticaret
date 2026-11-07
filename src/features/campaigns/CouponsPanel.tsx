"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, Download, Plus, Sparkles, Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import { Field, inputCls } from "@/components/admin/form";
import type { CampaignDetail, CouponRow } from "@/modules/campaigns/domain/campaign";
import { campaignsApi } from "./api";
import { localInputToIso } from "@/lib/form-values";

const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });

/**
 * Coupons of a campaign: add one code or generate a batch (e.g. 100 single-use codes for an influencer list),
 * see usage, deactivate, delete unused ones, download as CSV. Lives inside the editor form → buttons, no <form>.
 */
export function CouponsPanel({ campaign }: { campaign: CampaignDetail }) {
  const router = useRouter();
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [f, setF] = useState({ code: "", count: "20", prefix: "", maxRedemptions: "", perCustomer: "1", endsAt: "", allowWithPromotions: true });
  const [busy, setBusy] = useState(false);
  const errors = useFieldErrors();
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));

  const create = async () => {
    setBusy(true);
    errors.clear();
    try {
      const common = { maxRedemptions: f.maxRedemptions ? Number(f.maxRedemptions) : null, perCustomerLimit: Number(f.perCustomer) || 1, endsAt: localInputToIso(f.endsAt), allowWithPromotions: f.allowWithPromotions };
      const r = await campaignsApi.createCoupons(campaign.id, mode === "single" ? { ...common, code: f.code } : { ...common, generate: { count: Number(f.count) || 1, prefix: f.prefix || undefined } });
      notify.success(r.data.codes.length === 1 ? `“${r.data.codes[0]}” kuponu eklendi` : `${r.data.codes.length} kupon üretildi`);
      set({ code: "" });
      router.refresh();
    } catch (err) {
      const n = errors.fromError(err);
      notify.error(err, { description: n ? "İşaretli alanları kontrol edin." : undefined });
    } finally {
      setBusy(false);
    }
  };

  const change = async (k: CouponRow, action: "activate" | "deactivate" | "delete") => {
    try {
      await campaignsApi.changeCoupon(campaign.id, k.id, action);
      notify.success({ activate: "Kupon etkinleştirildi", deactivate: "Kupon pasif yapıldı", delete: "Kupon silindi" }[action], { description: k.code });
      router.refresh();
    } catch (err) {
      notify.error(err);
    }
  };

  const downloadCsv = () => {
    const rows = [["kod", "kullanim", "limit", "kisi_basi", "durum"], ...campaign.coupons.map((k) => [k.code, String(k.used), k.maxRedemptions == null ? "" : String(k.maxRedemptions), String(k.perCustomerLimit), k.isActive ? "aktif" : "pasif"])];
    const blob = new Blob([`﻿${rows.map((r) => r.join(";")).join("\n")}`], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `kuponlar-${campaign.name.slice(0, 30)}.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <AdminCard>
      <AdminCardTitle title={`Kuponlar (${campaign.coupons.length})`}
        subtitle={campaign.requiresCoupon ? "Bu kampanya yalnız kupon koduyla uygulanır." : "Kampanya kodsuz da uygulanır; kupon kodları yalnız takip / paylaşım içindir. Kodla sınırlamak için “Kupon kodu gereksin”i açın."}
        actions={campaign.coupons.length ? <button type="button" onClick={downloadCsv} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><Download className="size-3.5" />CSV</button> : null} />
      <div className="space-y-4 border-b border-slate-100 p-5">
        <div role="radiogroup" aria-label="Kupon ekleme" className="inline-flex rounded-lg bg-slate-100 p-0.5">
          {(["single", "batch"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
              className={`h-8 rounded-md px-3 text-sm font-medium ${mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{m === "single" ? "Tek kod" : "Toplu üret"}</button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {mode === "single" ? (
            <Field id="cp-code" label="Kod" error={errors.get("code")} className="lg:col-span-2">
              <input id="cp-code" className={`${inputCls} font-mono uppercase`} value={f.code} maxLength={40} placeholder="KASIM20" onChange={(e) => set({ code: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void create(); } }} aria-invalid={!!errors.get("code")} />
            </Field>
          ) : (
            <>
              <Field id="cp-count" label="Adet (en fazla 200)"><input id="cp-count" type="number" min={1} max={200} className={inputCls} value={f.count} onChange={(e) => set({ count: e.target.value })} /></Field>
              <Field id="cp-prefix" label="Ön ek" error={errors.get("code")}><input id="cp-prefix" className={`${inputCls} font-mono uppercase`} value={f.prefix} maxLength={20} placeholder="VIP" onChange={(e) => set({ prefix: e.target.value })} /></Field>
            </>
          )}
          <Field id="cp-max" label="Toplam kullanım" hint="Boş = sınırsız"><input id="cp-max" type="number" min={1} className={inputCls} value={f.maxRedemptions} onChange={(e) => set({ maxRedemptions: e.target.value })} /></Field>
          <Field id="cp-per" label="Kişi başı"><input id="cp-per" type="number" min={1} className={inputCls} value={f.perCustomer} onChange={(e) => set({ perCustomer: e.target.value })} /></Field>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-0.5 size-4 accent-[#7367f0]" checked={f.allowWithPromotions} onChange={(e) => set({ allowWithPromotions: e.target.checked })} />
          <span>Kampanyalı sepette de kullanılabilsin<span className="block text-xs text-slate-500">Kapalıysa, sepete otomatik bir kampanya indirimi uygulanmışken bu kod kabul edilmez.</span></span>
        </label>
        <button type="button" onClick={create} disabled={busy || (mode === "single" && f.code.trim().length < 3)}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
          {mode === "single" ? <Plus className="size-4" /> : <Sparkles className="size-4" />}{busy ? "Bekleyin…" : mode === "single" ? "Kuponu ekle" : "Kodları üret"}
        </button>
      </div>
      {campaign.coupons.length === 0 ? <p className="px-5 py-5 text-sm text-slate-500">Henüz kupon yok.</p> : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white"><tr className="text-left text-xs text-slate-500"><th className="px-5 py-2.5 font-medium">Kod</th><th className="px-3 py-2.5 font-medium">Kullanım</th><th className="px-3 py-2.5 font-medium">Durum</th><th className="px-5 py-2.5" /></tr></thead>
            <tbody>
              {campaign.coupons.map((k) => (
                <tr key={k.id} className="border-t border-slate-100">
                  <td className="px-5 py-2.5">
                    <span className="flex items-center gap-1.5 font-mono text-slate-800">{k.code}
                      <button type="button" aria-label={`${k.code} kopyala`} onClick={() => navigator.clipboard.writeText(k.code).then(() => notify.success("Kod kopyalandı"))} className="text-slate-400 hover:text-slate-700"><Copy className="size-3.5" /></button>
                    </span>
                    <span className="text-xs text-slate-500">Kişi başı {k.perCustomerLimit}{k.endsAt ? ` · ${day.format(new Date(k.endsAt))} tarihine kadar` : ""}{k.allowWithPromotions ? "" : " · kampanyalarla birleşmez"}</span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-700">{k.used}{k.maxRedemptions != null ? ` / ${k.maxRedemptions}` : ""}{k.reserved ? <span className="text-xs text-slate-400"> (+{k.reserved} sepette)</span> : null}</td>
                  <td className="px-3 py-2.5"><AdminBadge tone={k.isActive ? "green" : "slate"}>{k.isActive ? "Aktif" : "Pasif"}</AdminBadge></td>
                  <td className="px-5 py-2.5 text-right">
                    <span className="inline-flex gap-1">
                      <button type="button" onClick={() => change(k, k.isActive ? "deactivate" : "activate")} className="h-8 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">{k.isActive ? "Pasif yap" : "Etkinleştir"}</button>
                      {k.used + k.reserved === 0 ? <button type="button" onClick={() => change(k, "delete")} aria-label={`${k.code} sil`} className="grid size-8 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-3.5" /></button> : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminCard>
  );
}
