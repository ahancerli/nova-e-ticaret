"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type ComponentType } from "react";
import { AlertTriangle, Ban, Banknote, CheckCheck, Clock3, FileText, MessageSquarePlus, PackageCheck, PackageOpen, Printer, ReceiptText, SlidersHorizontal, Truck, X } from "lucide-react";
import { api, newIdempotencyKey } from "@/lib/api-client";
import { formatMinor } from "@/lib/money";
import { notify } from "@/lib/toast";
import { BULK_ACTIONS, ORDER_ACTIONS, ORDER_TABS, PAYMENT_STATUS, PROVIDER_LABEL, SHIPMENT_STATUS, orderStatusMeta, paymentStatusMeta, type OrderActionId } from "@/lib/order-rules";
import { Popover } from "@/components/ui/Popover";
import { AdminFormDialog } from "./AdminFormDialog";
import { Collapsible } from "@/components/ui/Collapsible";
import { DataGrid, type FetchPage, type GridColumn } from "@/components/ui/DataGrid";
import { AdminBadge, AdminCard, AdminPageHeader } from "./ui";

type Row = {
  id: string; orderNumber: string; customerName: string | null; customerEmail: string; isGuest: boolean; city: string | null;
  status: string; paymentStatus: string; provider: string | null; shipmentStatus: string | null; totalMinor: number; itemCount: number; placedAt: string;
};
type Kpi = { orders: number; revenue: number; waiting: number; to_ship: number; shipped: number };
type Filters = { paymentStatus: string; provider: string; from: string; to: string; minTotal: string; maxTotal: string };
const EMPTY: Filters = { paymentStatus: "", provider: "", from: "", to: "", minTotal: "", maxTotal: "" };

const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const AVATAR = ["bg-cyan-100 text-cyan-700", "bg-emerald-100 text-emerald-700", "bg-violet-100 text-violet-700", "bg-orange-100 text-orange-700", "bg-pink-100 text-pink-700", "bg-blue-100 text-blue-700"];
const initials = (name: string | null, email: string) =>
  ((name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toLocaleUpperCase("tr-TR")).join("") || email[0]?.toUpperCase()) ?? "?";
const tlToMinor = (s: string) => (s.trim() ? String(Math.round(Number(s.replace(/\./g, "").replace(",", ".")) * 100)) : "");

const BULK_ICON: Partial<Record<OrderActionId, ComponentType<{ className?: string }>>> = {
  prepare: PackageOpen, ship: Truck, deliver: PackageCheck, complete: CheckCheck, note: MessageSquarePlus, cancel: Ban,
};
type BulkResult = { id: string; orderNumber: string | null; ok: boolean; code?: string; message?: string };

export function OrdersManager({ initialSearch = "", permissions, shippingMethods }: { initialSearch?: string; permissions: string[]; shippingMethods: { id: string; name: string }[] }) {
  const router = useRouter();
  const [tab, setTab] = useState("all");
  const [selected, setSelected] = useState<Row[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);
  const [bulk, setBulk] = useState<OrderActionId | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkMethod, setBulkMethod] = useState(shippingMethods[0]?.id ?? "");
  const [failures, setFailures] = useState<BulkResult[]>([]);
  const perms = useMemo(() => new Set(permissions), [permissions]);
  const bulkActions = BULK_ACTIONS.filter((a) => perms.has(ORDER_ACTIONS[a].permission));

  const runBulk = async () => {
    if (!bulk) return;
    const action = bulk === "cancel" ? { action: "cancel", reason: bulkText.trim() }
      : bulk === "note" ? { action: "note", note: bulkText.trim() }
      : bulk === "ship" ? { action: "ship", shippingMethodId: bulkMethod }
      : { action: bulk };
    setBulkBusy(true);
    try {
      const r = await api<BulkResult[]>("/api/admin/orders/bulk", { method: "POST", json: { orderIds: selected.map((s) => s.id), action }, idempotencyKey: newIdempotencyKey() });
      const okCount = r.data.filter((x) => x.ok).length;
      const failed = r.data.filter((x) => !x.ok);
      if (okCount) notify.success(`${okCount} sipariş güncellendi`, { description: ORDER_ACTIONS[bulk].label });
      if (failed.length) setFailures(failed);
      setBulk(null);
      setBulkText("");
      setSelected([]);
      setRefreshToken((n) => n + 1);
    } catch (err) {
      notify.error(err, { fallback: "Toplu işlem yapılamadı." });
    } finally {
      setBulkBusy(false);
    }
  };

  const printSelected = (doc: "fatura" | "irsaliye") =>
    window.open(`/admin/yazdir?belge=${doc}&ids=${selected.map((s) => encodeURIComponent(s.id)).join(",")}`, "_blank", "noopener");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const statuses = ORDER_TABS.find((t) => t.key === tab)?.statuses ?? null;

  // New identity whenever tab / filters change → DataGrid refetches from page 1.
  const fetchPage = useCallback<FetchPage<Row>>(async ({ offset, limit, sort, search }) => {
    const q = new URLSearchParams({ page: String(Math.floor(offset / limit) + 1), pageSize: String(limit) });
    if (sort) { q.set("sort", sort.colId); q.set("dir", sort.sort); }
    if (search) q.set("q", search);
    if (statuses) q.set("status", statuses.join(","));
    if (filters.paymentStatus) q.set("paymentStatus", filters.paymentStatus);
    if (filters.provider) q.set("provider", filters.provider);
    if (filters.from) q.set("from", filters.from);
    if (filters.to) q.set("to", filters.to);
    const min = tlToMinor(filters.minTotal), max = tlToMinor(filters.maxTotal);
    if (min && min !== "NaN") q.set("minTotal", min);
    if (max && max !== "NaN") q.set("maxTotal", max);
    try {
      const r = await api<Row[]>(`/api/admin/orders?${q}`);
      setKpi((r.meta.kpi as Kpi | undefined) ?? null);
      setCounts((r.meta.statusCounts as Record<string, number> | undefined) ?? {});
      return { rows: r.data, total: Number(r.meta.total ?? 0) };
    } catch (err) {
      notify.error(err, { id: "orders-load", fallback: "Siparişler yüklenemedi." });
      throw err;
    }
  }, [statuses, filters]);

  const tabCount = (statuses: string[] | null) =>
    statuses ? statuses.reduce((a, s) => a + (counts[s] ?? 0), 0) : Object.values(counts).reduce((a, b) => a + b, 0);

  const activeFilters = (Object.keys(EMPTY) as (keyof Filters)[]).filter((k) => filters[k]);
  const chipLabel = (k: keyof Filters) => ({
    paymentStatus: `Ödeme: ${paymentStatusMeta(filters.paymentStatus).label}`,
    provider: `Yöntem: ${PROVIDER_LABEL[filters.provider] ?? filters.provider}`,
    from: `Başlangıç: ${filters.from}`, to: `Bitiş: ${filters.to}`,
    minTotal: `En az ₺${filters.minTotal}`, maxTotal: `En çok ₺${filters.maxTotal}`,
  })[k];

  const columns = useMemo<GridColumn<Row>[]>(() => [
    {
      colId: "order_number", field: "orderNumber", headerName: "Sipariş", sortable: true, minWidth: 160, pinned: "left",
      cellRenderer: (p: { data?: Row }) => p.data ? (
        <span className="flex h-full flex-col justify-center leading-tight">
          <Link href={`/admin/siparisler/${p.data.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-[#7367f0] hover:underline">#{p.data.orderNumber}</Link>
          <span className="text-xs text-slate-400">{p.data.itemCount} ürün</span>
        </span>
      ) : null,
    },
    { colId: "placed_at", field: "placedAt", headerName: "Tarih", sortable: true, minWidth: 170, valueFormatter: (p) => (p.value ? dateFmt.format(new Date(p.value)) : "") },
    {
      colId: "customer", headerName: "Müşteri", flex: 1, minWidth: 250, valueGetter: (p) => (p.data ? `${p.data.customerName ?? ""} ${p.data.customerEmail}` : ""),
      cellRenderer: (p: { data?: Row }) => {
        if (!p.data) return null;
        const tone = AVATAR[p.data.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];
        return (
          <span className="flex h-full items-center gap-3">
            <span className={`grid size-8 flex-none place-items-center rounded-full text-xs font-semibold ${tone}`}>{initials(p.data.customerName, p.data.customerEmail)}</span>
            <span className="min-w-0 leading-tight">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-medium text-slate-700">{p.data.customerName ?? "—"}</span>
                {p.data.isGuest ? <span className="rounded bg-slate-100 px-1.5 text-[10px] font-semibold uppercase text-slate-500">Misafir</span> : null}
              </span>
              <span className="block truncate text-xs text-slate-500">{p.data.customerEmail}{p.data.city ? ` · ${p.data.city}` : ""}</span>
            </span>
          </span>
        );
      },
    },
    {
      colId: "status", field: "status", headerName: "Durum", sortable: true, minWidth: 150, valueFormatter: (p) => orderStatusMeta(String(p.value)).label,
      cellRenderer: (p: { value?: string }) => { const s = orderStatusMeta(p.value ?? ""); return <AdminBadge tone={s.tone}>{s.label}</AdminBadge>; },
    },
    {
      colId: "payment", field: "paymentStatus", headerName: "Ödeme", minWidth: 130, valueFormatter: (p) => paymentStatusMeta(String(p.value)).label,
      cellRenderer: (p: { value?: string }) => {
        const s = paymentStatusMeta(p.value ?? "");
        const dot = { green: "bg-emerald-500 text-emerald-700", amber: "bg-amber-500 text-amber-700", red: "bg-rose-500 text-rose-600", slate: "bg-slate-400 text-slate-500", blue: "bg-blue-500 text-blue-700", purple: "bg-violet-500 text-violet-700" }[s.tone];
        return <span className={`inline-flex items-center gap-1.5 ${dot.split(" ")[1]}`}><span className={`size-2 rounded-full ${dot.split(" ")[0]}`} />{s.label}</span>;
      },
    },
    { colId: "provider", field: "provider", headerName: "Yöntem", minWidth: 130, valueFormatter: (p) => PROVIDER_LABEL[String(p.value)] ?? "—" },
    {
      colId: "shipment", field: "shipmentStatus", headerName: "Kargo", minWidth: 140, valueFormatter: (p) => SHIPMENT_STATUS[String(p.value)]?.label ?? "—",
      cellRenderer: (p: { value?: string | null }) => { const s = SHIPMENT_STATUS[p.value ?? ""]; return s ? <AdminBadge tone={s.tone}>{s.label}</AdminBadge> : <span className="text-slate-300">—</span>; },
    },
    { colId: "total_minor", field: "totalMinor", headerName: "Toplam", sortable: true, minWidth: 130, type: "rightAligned", cellClass: "font-semibold tabular-nums", valueFormatter: (p) => (p.value != null ? formatMinor(p.value) : "") },
  ], []);

  return (
    <div className="space-y-5">
      <AdminPageHeader title="Siparişler" subtitle="Tüm kanallardan gelen siparişler · bir satıra tıklayarak detayı ve işlemleri açın" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Toplam sipariş" value={kpi?.orders.toLocaleString("tr-TR")} icon={ReceiptText} tone="indigo" onClick={() => setTab("all")} active={tab === "all"} />
        <KpiCard label="Ödeme bekleyen" value={kpi?.waiting.toLocaleString("tr-TR")} icon={Clock3} tone="amber" onClick={() => setTab("waiting")} active={tab === "waiting"} />
        <KpiCard label="Hazırlanacak" value={kpi?.to_ship.toLocaleString("tr-TR")} icon={PackageOpen} tone="violet" onClick={() => setTab("todo")} active={tab === "todo"} />
        <KpiCard label="Tahsil edilen" value={kpi ? formatMinor(kpi.revenue) : undefined} icon={Banknote} tone="emerald" />
      </div>

      <AdminCard className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-3 pt-2 sm:px-4">
          <div role="tablist" aria-label="Sipariş durumları" className="no-scrollbar -mb-px flex gap-1 overflow-x-auto">
            {ORDER_TABS.map((t) => {
              const on = t.key === tab;
              const n = tabCount(t.statuses);
              return (
                <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)}
                  className={`relative flex flex-none items-center gap-2 px-3 py-3 text-sm transition-colors ${on ? "font-semibold text-[#5b4fe0]" : "text-slate-500 hover:text-slate-800"}`}>
                  {t.label}
                  <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums transition-colors ${on ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-500"}`}>{n}</span>
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
          <form className="grid gap-3 border-b border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-2 lg:grid-cols-6"
            onSubmit={(e) => { e.preventDefault(); setFilters(draft); setFiltersOpen(false); }}>
            <FilterField label="Ödeme durumu">
              <select className="input h-10 border-slate-200 text-sm" value={draft.paymentStatus} onChange={(e) => setDraft({ ...draft, paymentStatus: e.target.value })}>
                <option value="">Tümü</option>
                {Object.entries(PAYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </FilterField>
            <FilterField label="Ödeme yöntemi">
              <select className="input h-10 border-slate-200 text-sm" value={draft.provider} onChange={(e) => setDraft({ ...draft, provider: e.target.value })}>
                <option value="">Tümü</option>
                {Object.entries(PROVIDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </FilterField>
            <FilterField label="Başlangıç tarihi"><input type="date" className="input h-10 border-slate-200 text-sm" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></FilterField>
            <FilterField label="Bitiş tarihi"><input type="date" className="input h-10 border-slate-200 text-sm" value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></FilterField>
            <FilterField label="En az tutar (₺)"><input inputMode="decimal" className="input h-10 border-slate-200 text-sm" value={draft.minTotal} onChange={(e) => setDraft({ ...draft, minTotal: e.target.value })} /></FilterField>
            <FilterField label="En çok tutar (₺)"><input inputMode="decimal" className="input h-10 border-slate-200 text-sm" value={draft.maxTotal} onChange={(e) => setDraft({ ...draft, maxTotal: e.target.value })} /></FilterField>
            <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-6">
              <button type="button" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); }} className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100">Temizle</button>
              <button type="submit" className="inline-flex h-9 items-center rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df]">Uygula</button>
            </div>
          </form>
        </Collapsible>

        {activeFilters.length ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5">
            {activeFilters.map((k) => (
              <button key={k} type="button" onClick={() => setFilters({ ...filters, [k]: "" })}
                className="inline-flex animate-scale-in items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-[#5b4fe0] ring-1 ring-indigo-100 hover:bg-indigo-100">
                {chipLabel(k)} <X className="h-3 w-3" />
              </button>
            ))}
            <button type="button" onClick={() => setFilters(EMPTY)} className="text-xs font-medium text-slate-500 hover:text-slate-800">Tümünü temizle</button>
          </div>
        ) : null}

        <DataGrid<Row>
          columns={columns}
          fetchPage={fetchPage}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/admin/siparisler/${r.id}`)}
          selectable
          stateKey="admin-orders-v2"
          exportFileName="siparisler"
          searchPlaceholder="Sipariş no, e-posta veya alıcı adı"
          initialSearch={initialSearch}
          refreshToken={refreshToken}
          onSelectionChange={setSelected}
          emptyText="Bu görünümde sipariş yok."
          toolbarExtra={<span className="hidden items-center gap-1.5 text-xs text-slate-500 md:inline-flex"><Truck className="h-3.5 w-3.5" /> Kargoda: {kpi?.shipped ?? "—"}</span>}
        />
      </AdminCard>

      {/* Floating bulk action bar */}
      {selected.length ? (
        <div className="sticky bottom-4 z-30 animate-scale-in">
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-700/50 bg-slate-900/95 px-4 py-3 text-white shadow-[0_20px_50px_-15px_rgb(15_23_42/0.6)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-8 min-w-8 place-items-center rounded-lg bg-[#7367f0] px-2 text-sm font-bold tabular-nums">{selected.length}</span>
              <span className="text-sm font-medium">sipariş seçildi</span>
              <button type="button" onClick={() => { setSelected([]); setRefreshToken((n) => n + 1); }} className="text-xs text-slate-400 underline-offset-2 hover:text-white hover:underline">Seçimi kaldır</button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {bulkActions.map((a) => {
                const Icon = BULK_ICON[a] ?? FileText;
                return (
                  <button key={a} type="button" onClick={() => { setBulkText(""); setBulk(a); }}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm transition ${a === "cancel" ? "text-red-300 hover:bg-red-500/20" : "hover:bg-white/10"}`}>
                    <Icon className="h-4 w-4" /> {ORDER_ACTIONS[a].label}
                  </button>
                );
              })}
              <span className="mx-1 hidden h-6 w-px bg-white/15 sm:block" aria-hidden />
              <Popover label="Belge yazdır" align="end" panelClassName="w-56 text-slate-700"
                buttonClassName="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-sm font-medium transition hover:bg-white/20"
                button={<><Printer className="h-4 w-4" /> Yazdır</>}>
                {(close) => (
                  <div className="p-1.5">
                    <button type="button" onClick={() => { close(); printSelected("fatura"); }} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm hover:bg-slate-50"><ReceiptText className="h-4 w-4 text-slate-400" /> Sipariş özeti / fatura</button>
                    <button type="button" onClick={() => { close(); printSelected("irsaliye"); }} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm hover:bg-slate-50"><Truck className="h-4 w-4 text-slate-400" /> Sevk irsaliyesi</button>
                  </div>
                )}
              </Popover>
            </div>
          </div>
        </div>
      ) : null}

      <AdminFormDialog open={!!bulk} busy={bulkBusy} icon={bulk ? BULK_ICON[bulk] : undefined}
        tone={bulk === "cancel" ? "danger" : bulk === "complete" ? "success" : "primary"}
        title={bulk ? `${ORDER_ACTIONS[bulk].label} · ${selected.length} sipariş` : ""}
        description="Her sipariş ayrı ayrı kontrol edilir; bu işleme uygun olmayanlar atlanır ve size listelenir."
        submitLabel={bulk ? `${selected.length} siparişe uygula` : ""}
        submitDisabled={(bulk === "cancel" && bulkText.trim().length < 3) || (bulk === "note" && !bulkText.trim()) || (bulk === "ship" && !bulkMethod)}
        onCancel={() => setBulk(null)} onSubmit={() => void runBulk()}>
        {bulk === "ship" ? (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-600">Kargo yöntemi</span>
              <select data-autofocus className="input border-slate-200 text-sm" value={bulkMethod} onChange={(e) => setBulkMethod(e.target.value)}>
                {shippingMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <p className="text-xs text-slate-500">Her siparişin kalan tüm ürünleri tek gönderiyle kargoya verilir. Takip numaralarını kargo firması webhook’u veya sipariş detayından ekleyebilirsiniz.</p>
          </>
        ) : bulk === "cancel" || bulk === "note" ? (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-600">{bulk === "cancel" ? "İptal sebebi" : "Not"}<span className="text-red-500"> *</span></span>
            <textarea data-autofocus rows={3} maxLength={bulk === "cancel" ? 500 : 1000} className="input min-h-20 border-slate-200 py-2 text-sm" value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
          </label>
        ) : null}
      </AdminFormDialog>

      <AdminFormDialog open={failures.length > 0} icon={AlertTriangle} tone="primary" title={`${failures.length} sipariş işlenemedi`}
        description="Bu siparişler mevcut durumları nedeniyle atlandı:" submitLabel="Tamam" onSubmit={() => setFailures([])} onCancel={() => setFailures([])}>
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
          {failures.map((f) => (
            <li key={f.id} className="px-3 py-2 text-sm">
              {f.orderNumber ? <Link href={`/admin/siparisler/${f.id}`} className="font-semibold text-[#7367f0] hover:underline">#{f.orderNumber}</Link> : <span className="font-mono text-slate-500">{f.id}</span>}
              <p className="text-xs text-slate-500">{f.message}</p>
            </li>
          ))}
        </ul>
      </AdminFormDialog>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className="text-xs font-medium text-slate-600">{label}</span>{children}</label>;
}

const KPI_TONES = {
  indigo: "bg-indigo-50 text-[#7367f0]",
  amber: "bg-amber-50 text-amber-600",
  violet: "bg-violet-50 text-violet-600",
  emerald: "bg-emerald-50 text-emerald-600",
};

function KpiCard({ label, value, icon: Icon, tone, onClick, active }: { label: string; value?: string; icon: ComponentType<{ className?: string }>; tone: keyof typeof KPI_TONES; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <span className={`grid size-11 flex-none place-items-center rounded-xl ${KPI_TONES[tone]}`}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 text-left">
        {value == null ? <span className="skeleton block h-7 w-20" aria-hidden /> : <span className="block animate-fade-in truncate text-2xl font-semibold tabular-nums text-slate-800">{value}</span>}
        <span className="block text-sm text-slate-500">{label}</span>
      </span>
    </>
  );
  const cls = `flex w-full items-center gap-4 rounded-2xl border bg-white p-4 shadow-sm transition ${active ? "border-[#7367f0]/50 ring-2 ring-[#7367f0]/15" : "border-slate-200"}`;
  return onClick ? <button type="button" onClick={onClick} className={`${cls} hover:-translate-y-0.5 hover:shadow-md`}>{body}</button> : <div className={cls}>{body}</div>;
}
