"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Plus, Scale, TicketPercent } from "lucide-react";
import { notify } from "@/lib/toast";
import { formatMinor } from "@/lib/money";
import { DataGrid, type GridColumn } from "@/components/ui/DataGrid";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import { Field, inputCls } from "@/components/admin/form";
import { campaignsApi } from "./api";
import { BadgePreview } from "./CampaignEditor";
import { CAMPAIGN_KINDS, CAMPAIGN_STATUSES, CONFLICT_STRATEGIES, type CampaignStatus, type CampaignSummary, type PricingPolicy } from "@/modules/campaigns/domain/campaign";

const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });
const TABS: { key: "all" | CampaignStatus; label: string }[] = [
  { key: "all", label: "Tümü" }, { key: "active", label: "Yayında" }, { key: "scheduled", label: "Planlandı" }, { key: "draft", label: "Taslak" }, { key: "ended", label: "Sona erdi" },
];

/** Kampanyalar: status tabs + grid; a row opens the editor. */
export function CampaignsManager({ rows, policy, highlightId }: { rows: CampaignSummary[]; policy: PricingPolicy; highlightId: string | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<"all" | CampaignStatus>("all");

  useEffect(() => {
    if (!highlightId) return;
    const c = rows.find((r) => r.id === highlightId);
    if (c) notify.success("Kampanya kaydedildi", { id: `campaign-${highlightId}-${c.updatedAt}`, description: c.name });
    window.history.replaceState(null, "", window.location.pathname);
  }, [highlightId, rows]);

  const counts = useMemo(() => rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}), [rows]);
  const shown = tab === "all" ? rows : rows.filter((r) => r.status === tab);

  const columns = useMemo<GridColumn<CampaignSummary>[]>(() => [
    {
      colId: "name", field: "name", headerName: "Kampanya", flex: 1, minWidth: 260, sortable: true,
      cellRenderer: (p: { data?: CampaignSummary }) => p.data ? (
        <span className="flex h-full flex-col justify-center leading-tight">
          <span className="flex items-center gap-2 font-medium text-slate-800">{p.data.name}
            {p.data.badgeEmoji || p.data.badgeImageUrl || p.data.badgeLabel ? <BadgePreview emoji={p.data.badgeEmoji} imageUrl={p.data.badgeImageUrl} label={p.data.badgeLabel || p.data.valueLabel} /> : null}
          </span>
          <span className="text-xs text-slate-500">{CAMPAIGN_KINDS[p.data.kind]?.label ?? p.data.kind} · {p.data.valueLabel}{p.data.requiresCoupon ? " · kuponla" : ""}{p.data.firstOrderOnly ? " · ilk sipariş" : ""}</span>
        </span>
      ) : null,
    },
    {
      colId: "status", field: "status", headerName: "Durum", minWidth: 120, sortable: true, cellClass: "flex items-center",
      cellRenderer: (p: { data?: CampaignSummary }) => p.data ? <AdminBadge tone={CAMPAIGN_STATUSES[p.data.status].tone}>{CAMPAIGN_STATUSES[p.data.status].label}</AdminBadge> : null,
    },
    {
      colId: "period", headerName: "Tarih aralığı", minWidth: 210, valueGetter: (p) => p.data?.startsAt ?? "",
      valueFormatter: (p) => (p.data ? `${day.format(new Date(p.data.startsAt))} – ${p.data.endsAt ? day.format(new Date(p.data.endsAt)) : "süresiz"}` : ""),
    },
    { colId: "scope", headerName: "Kapsam", minWidth: 110, valueGetter: (p) => (p.data?.targetMode === "all" ? "Tüm ürünler" : "Seçili") },
    { colId: "coupons", field: "couponCount", headerName: "Kupon", width: 100, type: "rightAligned", sortable: true },
    { colId: "orders", field: "orderCount", headerName: "Sipariş", width: 100, type: "rightAligned", sortable: true },
    { colId: "discount", field: "discountMinor", headerName: "Verilen indirim", minWidth: 140, type: "rightAligned", sortable: true, valueFormatter: (p) => formatMinor(Number(p.value ?? 0)) },
  ], []);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Kampanyalar ve kuponlar"
        subtitle="İndirim kuralları sepet ve ödeme adımında otomatik uygulanır; kupon gerektiren kampanyalar yalnız kod girilince."
        actions={
          <Link href="/admin/kampanyalar/yeni" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df]">
            <Plus className="size-4" />Kampanya oluştur
          </Link>
        }
      />
      <PolicyPanel policy={policy} />
      <AdminCard className="overflow-hidden">
        <div role="tablist" aria-label="Durum" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-slate-200 px-3 pt-2 sm:px-4">
          {TABS.map((t) => {
            const on = t.key === tab;
            const n = t.key === "all" ? rows.length : counts[t.key] ?? 0;
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)}
                className={`relative flex flex-none items-center gap-2 px-3 py-3 text-sm ${on ? "font-semibold text-[#5b4fe0]" : "text-slate-500 hover:text-slate-800"}`}>
                {t.label}
                <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums ${on ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-500"}`}>{n}</span>
                <span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#7367f0] transition-transform ${on ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
              </button>
            );
          })}
        </div>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-[#7367f0]/10 text-[#7367f0]"><TicketPercent className="size-6" /></span>
            <p className="text-sm text-slate-600">Henüz kampanya yok. İlk kampanyanızı oluşturun.</p>
          </div>
        ) : (
          <DataGrid<CampaignSummary> columns={columns} rows={shown} getRowId={(c) => c.id} onRowClick={(c) => router.push(`/admin/kampanyalar/${c.id}`)}
            highlightRowId={highlightId} stateKey="admin-campaigns" exportFileName="kampanyalar" searchPlaceholder="Kampanya ara" emptyText="Bu durumda kampanya yok." height={480} />
        )}
      </AdminCard>
    </div>
  );
}

/** Shop-wide rules: how overlapping campaigns are resolved and the maximum total discount share (margin guard). */
function PolicyPanel({ policy }: { policy: PricingPolicy }) {
  const router = useRouter();
  const [strategy, setStrategy] = useState(policy.conflictStrategy);
  const [maxPct, setMaxPct] = useState(String(policy.maxDiscountBps / 100).replace(".", ","));
  const [busy, setBusy] = useState(false);
  const bps = Math.round(Number(maxPct.replace(",", ".")) * 100);
  const valid = Number.isFinite(bps) && bps >= 100 && bps <= 10000;
  const dirty = strategy !== policy.conflictStrategy || bps !== policy.maxDiscountBps;

  const save = async () => {
    setBusy(true);
    try {
      await campaignsApi.savePolicy({ conflictStrategy: strategy, maxDiscountBps: bps, expectedUpdatedAt: policy.updatedAt });
      notify.success("Kampanya kuralları kaydedildi");
      router.refresh();
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminCard>
      <AdminCardTitle title="Kampanya kuralları" subtitle="Sepet her zaman şu sırayla hesaplanır: 1. ürün indirimleri → 2. sepet indirimleri → 3. kupon → 4. kargo. Kampanyalar ürünün taban fiyatının altına indiremez." />
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
        <fieldset>
          <legend className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600"><Scale className="size-3.5" />Birden çok kampanya uyduğunda</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(CONFLICT_STRATEGIES) as PricingPolicy["conflictStrategy"][]).map((k) => (
              <label key={k} className={`flex cursor-pointer gap-2 rounded-xl border px-3 py-2.5 ${strategy === k ? "border-[#7367f0] bg-[#7367f0]/5" : "border-slate-200"}`}>
                <input type="radio" name="strategy" checked={strategy === k} onChange={() => setStrategy(k)} className="mt-0.5 accent-[#7367f0]" />
                <span><span className="block text-sm font-medium text-slate-800">{CONFLICT_STRATEGIES[k].label}</span><span className="block text-xs text-slate-500">{CONFLICT_STRATEGIES[k].hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field id="pp-max" label="Sepette en fazla indirim (%)" error={valid ? undefined : "%1 ile %100 arasında olmalı."} hint="Sepet tutarına oranla, kargo hariç.">
          <input id="pp-max" inputMode="decimal" className={inputCls} value={maxPct} onChange={(e) => setMaxPct(e.target.value)} aria-invalid={!valid} />
        </Field>
        <button type="button" onClick={save} disabled={busy || !dirty || !valid}
          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-50">{busy ? "Bekleyin…" : "Kaydet"}</button>
      </div>
    </AdminCard>
  );
}
