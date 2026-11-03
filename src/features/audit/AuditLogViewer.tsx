"use client";

import { useCallback, useMemo, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { notify } from "@/lib/toast";
import { Collapsible } from "@/components/ui/Collapsible";
import { DataGrid, type FetchPage, type GridColumn } from "@/components/ui/DataGrid";
import { AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { AUDIT_AREAS, type AuditArea, type AuditEntrySummary, type AuditFilterOptions } from "@/modules/audit/domain/audit";
import { auditApi } from "./api";
import { AuditDetailDrawer } from "./AuditDetailDrawer";
import { dateTime } from "./format";

type Filters = { actorId: string; entityType: string; entityId: string; from: string; to: string };
const EMPTY: Filters = { actorId: "", entityType: "", entityId: "", from: "", to: "" };

/** Denetim kayıtları: read-only, server-side paged audit trail with area tabs, filters and a detail drawer. */
export function AuditLogViewer({ options, initial }: { options: AuditFilterOptions; initial: Pick<Filters, "actorId" | "entityType" | "entityId"> }) {
  const [area, setArea] = useState<AuditArea>("all");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<Filters>({ ...EMPTY, ...initial });
  const [draft, setDraft] = useState<Filters>(filters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // New identity whenever tab / filters change → DataGrid refetches from page 1.
  const fetchPage = useCallback<FetchPage<AuditEntrySummary>>(async ({ offset, limit, sort, search }) => {
    const q = new URLSearchParams({ page: String(Math.floor(offset / limit) + 1), pageSize: String(limit), area });
    if (sort?.colId === "created_at") q.set("dir", sort.sort);
    if (search) q.set("q", search);
    for (const k of Object.keys(EMPTY) as (keyof Filters)[]) if (filters[k]) q.set(k, filters[k]);
    try {
      const r = await auditApi.list(q.toString());
      setCounts((r.meta.areaCounts as Record<string, number> | undefined) ?? {});
      return { rows: r.data, total: Number(r.meta.total ?? 0) };
    } catch (err) {
      notify.error(err, { id: "audit-load", fallback: "Denetim kayıtları yüklenemedi." });
      throw err;
    }
  }, [area, filters]);

  const actorName = (id: string) => options.actors.find((a) => a.id === id)?.name ?? id;
  const typeLabel = (v: string) => options.entityTypes.find((t) => t.value === v)?.label ?? v;
  const activeFilters = (Object.keys(EMPTY) as (keyof Filters)[]).filter((k) => filters[k]);
  const chipLabel = (k: keyof Filters) => ({
    actorId: `Kişi: ${actorName(filters.actorId)}`, entityType: `Tür: ${typeLabel(filters.entityType)}`, entityId: `Kayıt: ${filters.entityId}`,
    from: `Başlangıç: ${filters.from}`, to: `Bitiş: ${filters.to}`,
  })[k];
  const showRecordHistory = (entityType: string, entityId: string) => {
    setOpenId(null);
    setArea("all");
    setFilters({ ...EMPTY, entityType, entityId });
  };

  const columns = useMemo<GridColumn<AuditEntrySummary>[]>(() => [
    { colId: "created_at", field: "createdAt", headerName: "Zaman", minWidth: 170, sortable: true, pinned: "left", valueFormatter: (p) => (p.value ? dateTime.format(new Date(p.value)) : "") },
    {
      colId: "action", field: "actionLabel", headerName: "İşlem", flex: 1, minWidth: 240,
      cellRenderer: (p: { data?: AuditEntrySummary }) => p.data ? (
        <span className="flex h-full flex-col justify-center leading-tight">
          <span className="font-medium text-slate-800">{p.data.actionLabel}</span>
          <span className="font-mono text-[11px] text-slate-400">{p.data.action}</span>
        </span>
      ) : null,
    },
    {
      colId: "entity", headerName: "Kayıt", flex: 1, minWidth: 220, valueGetter: (p) => p.data ? `${p.data.entityLabel} ${p.data.entityName ?? p.data.entityId ?? ""}` : "",
      cellRenderer: (p: { data?: AuditEntrySummary }) => p.data ? (
        <span className="flex h-full flex-col justify-center leading-tight">
          <span className="text-slate-700">{p.data.entityName ?? (p.data.entityId ? <span className="font-mono text-xs">{p.data.entityId}</span> : "—")}</span>
          <span className="text-xs text-slate-500">{p.data.entityLabel}</span>
        </span>
      ) : null,
    },
    {
      colId: "actor", headerName: "Kişi", minWidth: 200, valueGetter: (p) => p.data?.actor?.name ?? "Sistem",
      cellRenderer: (p: { data?: AuditEntrySummary }) => p.data ? (
        p.data.actor ? (
          <span className="flex h-full flex-col justify-center leading-tight">
            <span className="text-slate-700">{p.data.actor.name}</span>
            <span className="text-xs text-slate-500">{p.data.actor.email}</span>
          </span>
        ) : <span className="text-slate-500">Sistem</span>
      ) : null,
    },
    { colId: "request", field: "requestId", headerName: "İstek", minWidth: 130, cellClass: "font-mono text-xs text-slate-500", valueFormatter: (p) => (p.value ? String(p.value).slice(0, 8) : "—") },
  ], []);

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Denetim kayıtları" subtitle="Panelde yapılan her değişiklik: kim, ne zaman, hangi kayıtta ne yaptı. Kayıtlar değiştirilemez ve silinemez." />
      <AdminCard className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-3 pt-2 sm:px-4">
          <div role="tablist" aria-label="İşlem alanı" className="no-scrollbar -mb-px flex gap-1 overflow-x-auto">
            {(Object.entries(AUDIT_AREAS) as [AuditArea, string][]).map(([key, label]) => {
              const on = key === area;
              return (
                <button key={key} type="button" role="tab" aria-selected={on} onClick={() => setArea(key)}
                  className={`relative flex flex-none items-center gap-2 px-3 py-3 text-sm transition-colors ${on ? "font-semibold text-[#5b4fe0]" : "text-slate-500 hover:text-slate-800"}`}>
                  {label}
                  <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums transition-colors ${on ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-500"}`}>{counts[key] ?? "–"}</span>
                  <span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#7367f0] transition-transform duration-300 ease-out-expo ${on ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => { setDraft(filters); setFiltersOpen((o) => !o); }} aria-expanded={filtersOpen}
            className={`mb-2 inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition ${filtersOpen || activeFilters.length ? "border-[#7367f0] bg-indigo-50 text-[#5b4fe0]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            <SlidersHorizontal className="h-4 w-4" /> Filtreler
            {activeFilters.length ? <span className="grid size-5 place-items-center rounded-full bg-[#7367f0] text-[11px] font-bold text-white">{activeFilters.length}</span> : null}
          </button>
        </div>

        <Collapsible open={filtersOpen}>
          <form className="grid gap-3 border-b border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => { e.preventDefault(); setFilters(draft); setFiltersOpen(false); }}>
            <FilterField label="Kişi">
              <select className="input h-10 border-slate-200 text-sm" value={draft.actorId} onChange={(e) => setDraft({ ...draft, actorId: e.target.value })}>
                <option value="">Tümü</option>
                {options.actors.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.email})</option>)}
              </select>
            </FilterField>
            <FilterField label="Kayıt türü">
              <select className="input h-10 border-slate-200 text-sm" value={draft.entityType} onChange={(e) => setDraft({ ...draft, entityType: e.target.value, entityId: "" })}>
                <option value="">Tümü</option>
                {options.entityTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </FilterField>
            <FilterField label="Başlangıç tarihi"><input type="date" className="input h-10 border-slate-200 text-sm" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></FilterField>
            <FilterField label="Bitiş tarihi"><input type="date" className="input h-10 border-slate-200 text-sm" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></FilterField>
            <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-4">
              <button type="button" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); }} className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100">Temizle</button>
              <button type="submit" className="inline-flex h-9 items-center rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df]">Uygula</button>
            </div>
          </form>
        </Collapsible>

        {activeFilters.length ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
            {activeFilters.map((k) => (
              <button key={k} type="button" onClick={() => setFilters({ ...filters, [k]: "", ...(k === "entityType" ? { entityId: "" } : {}) })}
                className="inline-flex animate-scale-in items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-[#5b4fe0] ring-1 ring-indigo-100 hover:bg-indigo-100">
                {chipLabel(k)} <X className="h-3 w-3" />
              </button>
            ))}
            <button type="button" onClick={() => setFilters(EMPTY)} className="text-xs font-medium text-slate-500 hover:text-slate-800">Tümünü temizle</button>
          </div>
        ) : null}

        <DataGrid<AuditEntrySummary>
          columns={columns} fetchPage={fetchPage} getRowId={(e) => e.id} onRowClick={(e) => setOpenId(e.id)} highlightRowId={openId}
          stateKey="admin-audit" exportFileName="denetim-kayitlari" searchPlaceholder="Kişi, işlem kodu, sipariş no veya istek no ara"
          emptyText="Bu görünümde denetim kaydı yok." height={600}
        />
      </AdminCard>

      <AuditDetailDrawer id={openId} onClose={() => setOpenId(null)} onOpen={setOpenId} onRecordHistory={showRecordHistory} />
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className="text-xs font-medium text-slate-600">{label}</span>{children}</label>;
}
