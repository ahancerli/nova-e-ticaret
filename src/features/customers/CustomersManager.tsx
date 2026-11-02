"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Mail, MessageSquare } from "lucide-react";
import { notify } from "@/lib/toast";
import { formatMinor } from "@/lib/money";
import { DataGrid, type FetchPage, type GridColumn } from "@/components/ui/DataGrid";
import { AdminBadge, AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { CUSTOMER_SEGMENTS, CUSTOMER_SORTS, type CustomerSegment, type CustomerSummary } from "@/modules/customers/domain/customer";
import { customersApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });
const SORTABLE = new Set<string>(CUSTOMER_SORTS);

/** Müşteriler: storefront members, server-side search / sort / paging, segment tabs with counts. */
export function CustomersManager() {
  const router = useRouter();
  const [segment, setSegment] = useState<CustomerSegment>("all");
  const [counts, setCounts] = useState<Record<string, number>>({});

  const fetchPage = useCallback<FetchPage<CustomerSummary>>(async ({ offset, limit, sort, search }) => {
    const q = new URLSearchParams({ page: String(Math.floor(offset / limit) + 1), pageSize: String(limit), segment });
    if (sort && SORTABLE.has(sort.colId)) { q.set("sort", sort.colId); q.set("dir", sort.sort); }
    if (search) q.set("q", search);
    try {
      const r = await customersApi.list(q.toString());
      setCounts((r.meta.segmentCounts as Record<string, number> | undefined) ?? {});
      return { rows: r.data, total: Number(r.meta.total ?? 0) };
    } catch (err) {
      notify.error(err, { id: "customers-load", fallback: "Müşteriler yüklenemedi." });
      throw err;
    }
  }, [segment]);

  const columns = useMemo<GridColumn<CustomerSummary>[]>(() => [
    {
      colId: "name", field: "name", headerName: "Müşteri", flex: 1, minWidth: 260, sortable: true, pinned: "left",
      cellRenderer: (p: { data?: CustomerSummary }) => p.data ? (
        <span className="flex h-full flex-col justify-center leading-tight">
          <span className="font-medium text-slate-800">{p.data.name}</span>
          <span className="text-xs text-slate-500">{p.data.email}</span>
        </span>
      ) : null,
    },
    { colId: "phone", field: "phone", headerName: "Telefon", minWidth: 150, valueFormatter: (p) => p.value || "—" },
    { colId: "order_count", field: "orderCount", headerName: "Sipariş", width: 110, sortable: true, type: "rightAligned" },
    { colId: "total_spent", field: "totalSpentMinor", headerName: "Harcama", minWidth: 130, sortable: true, type: "rightAligned", valueFormatter: (p) => formatMinor(Number(p.value ?? 0)) },
    { colId: "last_order_at", field: "lastOrderAt", headerName: "Son sipariş", minWidth: 140, sortable: true, valueFormatter: (p) => (p.value ? dt.format(new Date(p.value)) : "—") },
    {
      colId: "consent", headerName: "İleti izni", minWidth: 120, cellClass: "flex items-center",
      cellRenderer: (p: { data?: CustomerSummary }) => p.data ? (
        <span className="flex items-center gap-2 text-slate-400">
          <Mail className={`size-4 ${p.data.marketingEmail ? "text-emerald-600" : ""}`} aria-label={p.data.marketingEmail ? "E-posta izni var" : "E-posta izni yok"} />
          <MessageSquare className={`size-4 ${p.data.marketingSms ? "text-emerald-600" : ""}`} aria-label={p.data.marketingSms ? "SMS izni var" : "SMS izni yok"} />
        </span>
      ) : null,
    },
    { colId: "created_at", field: "createdAt", headerName: "Üyelik", minWidth: 130, sortable: true, valueFormatter: (p) => (p.value ? dt.format(new Date(p.value)) : "") },
    {
      colId: "status", field: "status", headerName: "Durum", minWidth: 110,
      cellRenderer: (p: { data?: CustomerSummary }) => p.data ? <AdminBadge tone={p.data.status === "active" ? "green" : "slate"}>{p.data.status === "active" ? "Aktif" : "Askıda"}</AdminBadge> : null,
    },
  ], []);

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Müşteriler" subtitle="Mağazadan üye olan müşteriler, sipariş ve harcama bilgileriyle. Misafir siparişler Siparişler ekranındadır." />
      <AdminCard className="overflow-hidden">
        <div role="tablist" aria-label="Müşteri grubu" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-slate-200 px-3 pt-2 sm:px-4">
          {(Object.entries(CUSTOMER_SEGMENTS) as [CustomerSegment, string][]).map(([key, label]) => {
            const on = key === segment;
            return (
              <button key={key} type="button" role="tab" aria-selected={on} onClick={() => setSegment(key)}
                className={`relative flex flex-none items-center gap-2 px-3 py-3 text-sm ${on ? "font-semibold text-[#5b4fe0]" : "text-slate-500 hover:text-slate-800"}`}>
                {label}
                <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums ${on ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-500"}`}>{counts[key] ?? "–"}</span>
                <span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#7367f0] transition-transform ${on ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
              </button>
            );
          })}
        </div>
        <DataGrid<CustomerSummary>
          columns={columns} fetchPage={fetchPage} getRowId={(c) => c.id} onRowClick={(c) => router.push(`/admin/musteriler/${c.id}`)}
          stateKey="admin-customers" exportFileName="musteriler" searchPlaceholder="Ad, e-posta veya telefon ara" emptyText="Bu grupta müşteri yok." height={560}
        />
      </AdminCard>
    </div>
  );
}
