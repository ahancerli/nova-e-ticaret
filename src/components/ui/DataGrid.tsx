"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type GridState,
  type IDatasource,
  type RowClassRules,
  type StateUpdatedEvent,
} from "ag-grid-community";
import { AG_GRID_LOCALE_TR } from "@ag-grid-community/locale";
import { Columns3, Download, Search, X } from "lucide-react";
import { Collapsible } from "./Collapsible";

/*
 * Project-wide data grid (AG Grid Community, MIT). Every list screen uses this component;
 * feature code never imports "ag-grid-*" directly.
 *
 * Modes
 *  - client: pass `rows`  → sorting, filtering, quick search and pagination happen in the browser.
 *  - server: pass `fetchPage` → infinite row model; sort + search + paging go to the API (allowlisted there).
 */
ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
  accentColor: "#7367f0",
  backgroundColor: "#ffffff",
  foregroundColor: "#334155",
  borderColor: "#e2e8f0",
  browserColorScheme: "light",
  fontFamily: "inherit",
  fontSize: 14,
  headerBackgroundColor: "#f8fafc",
  headerTextColor: "#64748b",
  headerFontSize: 12,
  headerFontWeight: 600,
  rowHoverColor: "#f5f3ff",
  selectedRowBackgroundColor: "#eef2ff",
  rowHeight: 56,
  headerHeight: 44,
  spacing: 7,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  columnBorder: false,
});

export type GridColumn<T> = ColDef<T>;
export type ServerSort = { colId: string; sort: "asc" | "desc" } | null;
export type FetchPage<T> = (q: { offset: number; limit: number; sort: ServerSort; search: string }) => Promise<{ rows: T[]; total: number }>;

type Props<T> = {
  columns: GridColumn<T>[];
  getRowId: (row: T) => string;
  rows?: T[];
  fetchPage?: FetchPage<T>;
  onRowClick?: (row: T) => void;
  highlightRowId?: string | null;
  selectable?: boolean;
  /** Persists column order/width/visibility and sort per user (localStorage). */
  stateKey?: string;
  exportFileName?: string;
  searchPlaceholder?: string;
  pageSize?: number;
  height?: number;
  emptyText?: string;
  toolbarExtra?: ReactNode;
  /** Increment to refetch server data (e.g. after a mutation). */
  refreshToken?: number;
  /** Pre-filled quick search (e.g. from a ?q= deep link). */
  initialSearch?: string;
  /** Selected rows (requires `selectable`). Cleared whenever the data is refreshed. */
  onSelectionChange?: (rows: T[]) => void;
};

function EmptyOverlay({ text }: { text: string }) {
  return <span className="text-sm text-slate-500">{text}</span>;
}

/** Neutralises CSV/Excel formula injection (=, +, -, @, tab, CR at cell start). */
function safeCsv(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function loadState(key?: string): GridState | undefined {
  if (!key) return undefined;
  try {
    const raw = localStorage.getItem(`grid:${key}`);
    return raw ? (JSON.parse(raw) as GridState) : undefined;
  } catch {
    return undefined;
  }
}

export function DataGrid<T>({
  columns,
  getRowId,
  rows,
  fetchPage,
  onRowClick,
  highlightRowId,
  selectable = false,
  stateKey,
  exportFileName,
  searchPlaceholder = "Ara…",
  pageSize = 25,
  height = 620,
  emptyText = "Kayıt bulunamadı.",
  toolbarExtra,
  refreshToken = 0,
  initialSearch = "",
  onSelectionChange,
}: Props<T>) {
  const server = !!fetchPage;
  const apiRef = useRef<GridApi<T> | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [debounced, setDebounced] = useState(initialSearch);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const [initialState] = useState(() => loadState(stateKey));

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const defaultColDef = useMemo<ColDef<T>>(() => ({ sortable: !server, resizable: true, filter: !server, minWidth: 90, suppressHeaderMenuButton: server }), [server]);

  // A new datasource makes the grid refetch from the first page. Callers memoise `fetchPage` on their filters,
  // so a filter change → new fetchPage → new datasource (no stale-closure race with child effects).
  const datasource = useMemo<IDatasource | undefined>(() => {
    if (!fetchPage) return undefined;
    void refreshToken;
    return {
      getRows: (p) => {
        const s = p.sortModel[0];
        fetchPage({ offset: p.startRow, limit: p.endRow - p.startRow, sort: s ? { colId: s.colId, sort: s.sort } : null, search: debounced })
          .then((r) => p.successCallback(r.rows, r.total))
          .catch(() => p.failCallback());
      },
    };
  }, [fetchPage, debounced, refreshToken]);

  const rowClassRules = useMemo<RowClassRules<T>>(
    () => ({ "nova-row-highlight": (p) => !!highlightRowId && !!p.data && getRowId(p.data) === highlightRowId }),
    [highlightRowId, getRowId],
  );

  useEffect(() => {
    apiRef.current?.redrawRows();
  }, [highlightRowId]);

  // New data → previous selection no longer describes what the user sees.
  useEffect(() => {
    apiRef.current?.deselectAll();
  }, [datasource, rows]);

  const syncVisibility = useCallback((api: GridApi<T>) => {
    const v: Record<string, boolean> = {};
    for (const c of api.getColumns() ?? []) v[c.getColId()] = c.isVisible();
    setVisibility(v);
  }, []);

  const onGridReady = (e: GridReadyEvent<T>) => {
    apiRef.current = e.api;
    syncVisibility(e.api);
  };

  const onStateUpdated = (e: StateUpdatedEvent<T>) => {
    if (!stateKey) return;
    const { columnOrder, columnSizing, columnVisibility, sort } = e.state;
    try {
      localStorage.setItem(`grid:${stateKey}`, JSON.stringify({ columnOrder, columnSizing, columnVisibility, sort }));
    } catch {
      /* storage unavailable (private mode) → state simply isn't remembered */
    }
  };

  const exportCsv = () =>
    apiRef.current?.exportDataAsCsv({
      fileName: `${exportFileName ?? "liste"}-${new Date().toISOString().slice(0, 10)}.csv`,
      processCellCallback: (p) => safeCsv(p.value),
      processHeaderCallback: (p) => safeCsv(p.column.getColDef().headerName ?? p.column.getColId()),
    });

  const hideable = columns.filter((c) => c.headerName && (c.colId ?? c.field));

  return (
    <div className="nova-grid">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
        <label className="relative w-full sm:max-w-xs">
          <span className="sr-only">{searchPlaceholder}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={searchPlaceholder} className="input h-10 border-slate-200 pl-9 pr-9 text-sm" />
          {search ? (
            <button type="button" aria-label="Aramayı temizle" onClick={() => setSearch("")} className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {toolbarExtra}
          <button type="button" onClick={() => setColumnsOpen((v) => !v)} aria-expanded={columnsOpen}
            className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm transition ${columnsOpen ? "border-[#7367f0] bg-indigo-50 text-[#5b4fe0]" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            <Columns3 className="h-4 w-4" /> Kolonlar
          </button>
          {exportFileName ? (
            <button type="button" onClick={exportCsv} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-600 transition hover:bg-slate-50">
              <Download className="h-4 w-4" /> CSV
            </button>
          ) : null}
        </div>
      </div>

      <Collapsible open={columnsOpen}>
        <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-5">
          {hideable.map((c) => {
            const id = (c.colId ?? c.field) as string;
            const on = visibility[id] ?? !c.hide;
            return (
              <label key={id} className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${on ? "border-[#7367f0]/40 bg-white text-slate-700" : "border-slate-200 bg-transparent text-slate-400"}`}>
                <input type="checkbox" className="size-3.5 accent-[#7367f0]" checked={on}
                  onChange={() => { apiRef.current?.setColumnsVisible([id], !on); if (apiRef.current) syncVisibility(apiRef.current); }} />
                {c.headerName}
              </label>
            );
          })}
        </div>
      </Collapsible>

      <div style={{ height }}>
        <AgGridReact<T>
          theme={theme}
          localeText={AG_GRID_LOCALE_TR}
          columnDefs={columns}
          defaultColDef={defaultColDef}
          getRowId={(p) => getRowId(p.data)}
          rowData={server ? undefined : rows}
          rowModelType={server ? "infinite" : "clientSide"}
          datasource={datasource}
          cacheBlockSize={pageSize}
          maxBlocksInCache={4}
          quickFilterText={server ? undefined : debounced}
          pagination
          paginationPageSize={pageSize}
          paginationPageSizeSelector={[10, 25, 50, 100]}
          rowSelection={selectable ? { mode: "multiRow", checkboxes: true, headerCheckbox: true, enableClickSelection: false } : undefined}
          onRowClicked={onRowClick ? (e) => e.data && onRowClick(e.data) : undefined}
          rowClassRules={rowClassRules}
          rowClass={onRowClick ? "cursor-pointer" : undefined}
          initialState={initialState}
          onStateUpdated={onStateUpdated}
          onGridReady={onGridReady}
          onColumnVisible={(e) => syncVisibility(e.api)}
          onSelectionChanged={onSelectionChange ? (e) => onSelectionChange(e.api.getSelectedRows()) : undefined}
          noRowsOverlayComponent={EmptyOverlay}
          noRowsOverlayComponentParams={{ text: emptyText }}
          enableCellTextSelection
          ensureDomOrder
          animateRows
          suppressCellFocus={!!onRowClick}
        />
      </div>
    </div>
  );
}
