"use client";

import { useCallback, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { DataGrid, type FetchPage, type GridColumn } from "@/components/ui/DataGrid";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminBadge, AdminCard, AdminPageHeader } from "@/components/admin/ui";
import {
  SUBSCRIBER_SORTS, SUBSCRIBER_SOURCES, SUBSCRIBER_STATUSES, SUBSCRIBER_TABS, type SubscriberRow, type SubscriberStatus, type SubscriberTab,
} from "@/modules/newsletter/domain/newsletter";
import { newsletterAdminApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Istanbul" });
const SORTABLE = new Set<string>(SUBSCRIBER_SORTS);
const TONE: Record<SubscriberStatus, "green" | "amber" | "slate"> = { subscribed: "green", pending: "amber", unsubscribed: "slate" };

/**
 * E-bülten: footer sign-ups (double opt-in). Only "Abone" rows confirmed by e-mail may receive newsletters; the grid's
 * export gives the list for the mailing tool. Deleting a row answers a KVKK erasure request (consent history stays).
 */
export function NewsletterManager({ canDelete }: { canDelete: boolean }) {
  const [tab, setTab] = useState<SubscriberTab>("subscribed");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [removing, setRemoving] = useState<SubscriberRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const fetchPage = useCallback<FetchPage<SubscriberRow>>(async ({ offset, limit, sort, search }) => {
    const q = new URLSearchParams({ page: String(Math.floor(offset / limit) + 1), pageSize: String(limit), tab });
    if (sort && SORTABLE.has(sort.colId)) { q.set("sort", sort.colId); q.set("dir", sort.sort); }
    if (search) q.set("q", search);
    try {
      const r = await newsletterAdminApi.list(q.toString());
      setCounts((r.meta.counts as Record<string, number> | undefined) ?? {});
      return { rows: r.data, total: Number(r.meta.total ?? 0) };
    } catch (err) {
      notify.error(err, { id: "newsletter-load", fallback: "Aboneler yüklenemedi." });
      throw err;
    }
  }, [tab]);

  const columns = useMemo<GridColumn<SubscriberRow>[]>(() => [
    {
      colId: "email", field: "email", headerName: "E-posta", flex: 1, minWidth: 260, sortable: true, pinned: "left",
      cellRenderer: (p: { data?: SubscriberRow }) => p.data ? (
        <span className="flex h-full flex-col justify-center leading-tight">
          <span className="font-medium text-slate-800">{p.data.email}</span>
          {p.data.memberName ? <span className="text-xs text-slate-500">Üye: {p.data.memberName}</span> : null}
        </span>
      ) : null,
    },
    {
      colId: "status", field: "status", headerName: "Durum", minWidth: 140, valueFormatter: (p) => SUBSCRIBER_STATUSES[p.value as SubscriberStatus] ?? "",
      cellRenderer: (p: { data?: SubscriberRow }) => p.data ? <AdminBadge tone={TONE[p.data.status]}>{SUBSCRIBER_STATUSES[p.data.status]}</AdminBadge> : null,
    },
    { colId: "source", field: "source", headerName: "Kaynak", minWidth: 140, valueFormatter: (p) => SUBSCRIBER_SOURCES[p.value as keyof typeof SUBSCRIBER_SOURCES] ?? "" },
    { colId: "created_at", field: "createdAt", headerName: "Kayıt", minWidth: 130, sortable: true, valueFormatter: (p) => (p.value ? dt.format(new Date(p.value)) : "") },
    { colId: "confirmed_at", field: "confirmedAt", headerName: "Onay", minWidth: 130, sortable: true, valueFormatter: (p) => (p.value ? dt.format(new Date(p.value)) : "—") },
    { colId: "unsubscribed_at", field: "unsubscribedAt", headerName: "Ayrılma", minWidth: 130, valueFormatter: (p) => (p.value ? dt.format(new Date(p.value)) : "—") },
    ...(canDelete ? [{
      colId: "actions", headerName: "", width: 70, sortable: false, cellClass: "flex items-center justify-center",
      cellRenderer: (p: { data?: SubscriberRow }) => p.data ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); setRemoving(p.data!); }} aria-label={`${p.data.email} sil`} title="Sil (KVKK)"
          className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
      ) : null,
    } satisfies GridColumn<SubscriberRow>] : []),
  ], [canDelete]);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await newsletterAdminApi.remove(removing.id);
      notify.success("Abone silindi");
      setRefresh((n) => n + 1);
    } catch (err) {
      notify.error(err, { fallback: "Abone silinemedi." });
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title="E-bülten" subtitle="Site altındaki formdan kayıt olanlar. Yalnızca e-postadaki bağlantıyla onaylayan “Abone” kişilere e-bülten gönderin; listeyi dışa aktarıp e-posta aracınıza yükleyebilirsiniz." />
      <AdminCard className="overflow-hidden">
        <div role="tablist" aria-label="Abone durumu" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-slate-200 px-3 pt-2 sm:px-4">
          {(Object.entries(SUBSCRIBER_TABS) as [SubscriberTab, string][]).map(([key, label]) => {
            const on = key === tab;
            return (
              <button key={key} type="button" role="tab" aria-selected={on} onClick={() => setTab(key)}
                className={`relative flex flex-none items-center gap-2 px-3 py-3 text-sm ${on ? "font-semibold text-[#5b4fe0]" : "text-slate-500 hover:text-slate-800"}`}>
                {label}
                <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums ${on ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-500"}`}>{counts[key] ?? "–"}</span>
                <span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#7367f0] transition-transform ${on ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
              </button>
            );
          })}
        </div>
        <DataGrid<SubscriberRow>
          columns={columns} fetchPage={fetchPage} getRowId={(r) => r.id} refreshToken={refresh}
          stateKey="admin-newsletter" exportFileName="e-bulten-aboneleri" searchPlaceholder="E-posta veya üye adı ara" emptyText="Bu grupta abone yok." height={560}
        />
      </AdminCard>
      <AdminConfirmDialog open={!!removing} title="Abone silinsin mi?" confirmLabel="Sil" busyLabel="Siliniyor…" busy={busy}
        description={removing ? `${removing.email} listeden kalıcı olarak silinecek (KVKK silme talebi). Onay geçmişi ispat için saklanır.` : undefined}
        onConfirm={() => void remove()} onCancel={() => setRemoving(null)} />
    </div>
  );
}
