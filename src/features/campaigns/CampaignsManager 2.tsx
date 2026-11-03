"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Plus, TicketPercent } from "lucide-react";
import { notify } from "@/lib/toast";
import { formatMinor } from "@/lib/money";
import { DataGrid, type GridColumn } from "@/components/ui/DataGrid";
import { AdminBadge, AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { CAMPAIGN_KINDS, CAMPAIGN_STATUSES, type CampaignStatus, type CampaignSummary } from "@/modules/campaigns/domain/campaign";

const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });
const TABS: { key: "all" | CampaignStatus; label: string }[] = [
  { key: "all", label: "Tümü" }, { key: "active", label: "Yayında" }, { key: "scheduled", label: "Planlandı" }, { key: "draft", label: "Taslak" }, { key: "ended", label: "Sona erdi" },
];

/** Kampanyalar: status tabs + grid; a row opens the editor. */
export function CampaignsManager({ rows, highlightId }: { rows: CampaignSummary[]; highlightId: string | null }) {
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
          <span className="font-medium text-slate-800">{p.data.name}</span>
          <span className="text-xs text-slate-500">{CAMPAIGN_KINDS[p.data.kind]?.label ?? p.data.kind} · {p.data.valueLabel}{p.data.requiresCoupon ? " · kuponla" : ""}</span>
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
