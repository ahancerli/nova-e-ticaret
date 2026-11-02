"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { Package, Plus } from "lucide-react";
import { formatMinor } from "@/lib/money";
import type { ProductListRow } from "@/server/services/admin-products";
import { DataGrid, type GridColumn } from "@/components/ui/DataGrid";
import { AdminBadge, AdminCard, AdminPageHeader } from "./ui";
import { statusMeta } from "@/lib/product-rules";

const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });

/** Product list. Create / edit happen on their own pages (/admin/urunler/yeni, /admin/urunler/[id]). */
export function ProductsManager({ rows, canWrite, highlightId }: { rows: ProductListRow[]; canWrite: boolean; highlightId: string | null }) {
  const router = useRouter();

  // Drop ?vurgula=… after the first paint; the highlighted row stays tinted.
  useEffect(() => {
    if (highlightId) window.history.replaceState(null, "", window.location.pathname);
  }, [highlightId]);

  const columns = useMemo<GridColumn<ProductListRow>[]>(() => [
    {
      colId: "name", field: "name", headerName: "Ürün", flex: 1, minWidth: 280, pinned: "left",
      cellRenderer: (p: { data?: ProductListRow }) => p.data ? (
        <span className="flex h-full items-center gap-3">
          <span className="grid size-10 flex-none place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {p.data.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.data.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : <Package className="h-4 w-4 text-slate-300" />}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-medium text-slate-800">{p.data.name}</span>
            <span className="block truncate font-mono text-xs text-slate-400">/{p.data.slug}</span>
          </span>
        </span>
      ) : null,
    },
    { colId: "brandName", field: "brandName", headerName: "Marka", minWidth: 140, valueFormatter: (p) => p.value ?? "—" },
    { colId: "categoryName", field: "categoryName", headerName: "Kategori", minWidth: 150, valueFormatter: (p) => p.value ?? "—" },
    {
      colId: "price", field: "minPriceMinor", headerName: "Fiyat", minWidth: 150, type: "rightAligned", filter: "agNumberColumnFilter", cellClass: "tabular-nums font-medium",
      valueFormatter: (p) => {
        const r = p.data;
        if (!r || r.minPriceMinor == null) return "—";
        return r.maxPriceMinor != null && r.maxPriceMinor !== r.minPriceMinor ? `${formatMinor(r.minPriceMinor)} – ${formatMinor(r.maxPriceMinor)}` : formatMinor(r.minPriceMinor);
      },
    },
    { colId: "variantCount", field: "variantCount", headerName: "Varyant", minWidth: 100, type: "rightAligned", filter: "agNumberColumnFilter", cellClass: "tabular-nums" },
    {
      colId: "available", field: "available", headerName: "Stok", minWidth: 110, type: "rightAligned", filter: "agNumberColumnFilter",
      cellRenderer: (p: { value?: number }) => {
        const n = p.value ?? 0;
        const tone = n <= 0 ? "text-red-600" : n <= 3 ? "text-amber-600" : "text-slate-700";
        return <span className={`font-medium tabular-nums ${tone}`}>{n <= 0 ? "Tükendi" : n.toLocaleString("tr-TR")}</span>;
      },
    },
    {
      colId: "status", field: "status", headerName: "Durum", minWidth: 130, valueFormatter: (p) => statusMeta(String(p.value)).label,
      cellRenderer: (p: { value?: string }) => { const s = statusMeta(p.value ?? ""); return <AdminBadge tone={s.tone}>{s.label}</AdminBadge>; },
    },
    { colId: "updatedAt", field: "updatedAt", headerName: "Güncellendi", minWidth: 170, valueFormatter: (p) => (p.value ? dt.format(new Date(p.value)) : "") },
  ], []);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Ürünler"
        subtitle={`${rows.length} ürün · düzenlemek için bir satıra tıklayın`}
        actions={canWrite ? (
          <Link href="/admin/urunler/yeni"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 transition hover:-translate-y-px hover:bg-[#6559df] hover:shadow-md hover:shadow-[#7367f0]/30">
            <Plus className="h-4 w-4" /> Ürün ekle
          </Link>
        ) : null}
      />

      <AdminCard className="overflow-hidden">
        <DataGrid<ProductListRow>
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          onRowClick={canWrite ? (r) => router.push(`/admin/urunler/${r.id}`) : undefined}
          highlightRowId={highlightId}
          selectable
          stateKey="admin-products"
          exportFileName="urunler"
          searchPlaceholder="Ürün, marka, kategori veya slug ara"
          emptyText="Henüz ürün yok. Üstten “Ürün ekle” ile başlayın."
          height={640}
        />
      </AdminCard>
    </div>
  );
}
