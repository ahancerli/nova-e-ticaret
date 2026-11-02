"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, Save, Tags, Trash2 } from "lucide-react";
import { brandsApi } from "./api";
import { notify } from "@/lib/toast";
import type { BrandRow } from "@/modules/catalog";
import { DataGrid, type GridColumn } from "@/components/ui/DataGrid";
import { AdminBadge, AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { BrandForm } from "@/features/catalog/brands/BrandForm";

const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });

export function BrandsManager({ initial, createdId }: { initial: BrandRow[]; createdId: string | null }) {
  const [rows, setRows] = useState<BrandRow[]>(initial);
  // editingId outlives `drawerOpen` so the drawer keeps its content during the slide-out animation.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(createdId);
  const [formBusy, setFormBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!createdId) return;
    const created = initial.find((b) => b.id === createdId);
    if (created) notify.success("Marka eklendi", { id: `brand-created-${createdId}`, description: created.name });
    window.history.replaceState(null, "", window.location.pathname);
  }, [createdId, initial]);

  const editing = useMemo(() => rows.find((b) => b.id === editingId) ?? null, [rows, editingId]);

  const reload = useCallback(async () => {
    const r = await brandsApi.list();
    setRows(r.data);
  }, []);

  const openEditor = useCallback((b: BrandRow) => {
    setEditingId(b.id);
    setHighlightId(b.id);
    setDrawerOpen(true);
  }, []);
  const closeEditor = useCallback(() => setDrawerOpen(false), []);

  const onSaved = async (id: string) => {
    await reload();
    setDrawerOpen(false);
    setHighlightId(id);
    notify.success("Marka güncellendi", { description: rows.find((b) => b.id === id)?.name });
  };

  const remove = async () => {
    if (!editing) return;
    const { id, name } = editing;
    setDeleting(true);
    try {
      await brandsApi.remove(id);
      setConfirmOpen(false);
      setDrawerOpen(false);
      setHighlightId(null);
      await reload();
      notify.success("Marka silindi", { description: name });
    } catch (err) {
      setConfirmOpen(false);
      notify.error(err, { fallback: "Marka silinemedi." });
    } finally {
      setDeleting(false);
    }
  };

  const columns = useMemo<GridColumn<BrandRow>[]>(() => [
    {
      colId: "name", field: "name", headerName: "Marka", flex: 1, minWidth: 240, pinned: "left",
      cellRenderer: (p: { data?: BrandRow }) => p.data ? (
        <span className="flex h-full items-center gap-3">
          <span className="grid size-9 flex-none place-items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
            {p.data.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.data.logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
            ) : <Tags className="h-4 w-4 text-slate-300" />}
          </span>
          <span className="min-w-0 leading-tight">
            <span className={`block truncate font-medium ${p.data.isActive ? "text-slate-800" : "text-slate-400"}`}>{p.data.name}</span>
            <span className="block truncate font-mono text-xs text-slate-400">/{p.data.slug}</span>
          </span>
        </span>
      ) : null,
    },
    { colId: "slug", field: "slug", headerName: "Slug", minWidth: 150, hide: true },
    {
      colId: "websiteUrl", field: "websiteUrl", headerName: "Web sitesi", minWidth: 200,
      cellRenderer: (p: { value?: string | null }) => p.value ? (
        <a href={p.value} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className="inline-flex max-w-full items-center gap-1 truncate text-[#7367f0] hover:underline">
          <span className="truncate">{p.value.replace(/^https?:\/\//, "")}</span><ExternalLink className="h-3 w-3 flex-none" />
        </a>
      ) : <span className="text-slate-300">—</span>,
    },
    { colId: "productCount", field: "productCount", headerName: "Ürün", minWidth: 100, type: "rightAligned", filter: "agNumberColumnFilter", cellClass: "tabular-nums" },
    { colId: "storyCount", field: "storyCount", headerName: "Hikaye", minWidth: 100, type: "rightAligned", filter: "agNumberColumnFilter", cellClass: "tabular-nums" },
    {
      colId: "isActive", field: "isActive", headerName: "Durum", minWidth: 110, valueFormatter: (p) => (p.value ? "Aktif" : "Pasif"),
      cellRenderer: (p: { value?: boolean }) => <AdminBadge tone={p.value ? "green" : "slate"}>{p.value ? "Aktif" : "Pasif"}</AdminBadge>,
    },
    { colId: "updatedAt", field: "updatedAt", headerName: "Güncellendi", minWidth: 170, valueFormatter: (p) => (p.value ? dt.format(new Date(p.value)) : "") },
    { colId: "description", field: "description", headerName: "Açıklama", minWidth: 220, hide: true, tooltipField: "description" },
  ], []);

  const blockers = editing ? [editing.productCount ? `${editing.productCount} ürün` : null, editing.storyCount ? `${editing.storyCount} hikaye` : null].filter(Boolean) : [];
  const canDelete = !!editing && blockers.length === 0;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Markalar"
        subtitle={`${rows.length} marka · düzenlemek için bir satıra tıklayın`}
        actions={
          <Link href="/admin/markalar/yeni" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 transition hover:-translate-y-px hover:bg-[#6559df] hover:shadow-md hover:shadow-[#7367f0]/30">
            <Plus className="h-4 w-4" />
            Marka ekle
          </Link>
        }
      />

      <AdminCard className="overflow-hidden">
        <DataGrid<BrandRow>
          columns={columns}
          rows={rows}
          getRowId={(b) => b.id}
          onRowClick={openEditor}
          highlightRowId={drawerOpen ? editingId : highlightId}
          stateKey="admin-brands"
          exportFileName="markalar"
          searchPlaceholder="Marka, slug veya web sitesi ara"
          emptyText="Henüz marka yok. Üstten “Marka ekle” ile başlayın."
          height={560}
        />
      </AdminCard>

      <AdminDrawer
        open={drawerOpen && !!editing}
        onClose={closeEditor}
        title={editing ? `${editing.name} düzenle` : "Marka düzenle"}
        subtitle={editing ? `/marka/${editing.slug}` : undefined}
        footer={
          editing ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canDelete || deleting || formBusy}
                title={canDelete ? undefined : `Silinemez: ${blockers.join(", ")} bağlı.`}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                <Trash2 className="h-4 w-4" />
                Sil
              </button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button type="button" onClick={closeEditor} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                  Vazgeç
                </button>
                <button type="submit" form="brand-edit-form" disabled={formBusy || deleting}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white transition hover:bg-[#6559df] disabled:opacity-60">
                  <Save className="h-4 w-4" />
                  {formBusy ? "Bekleyin…" : "Güncelle"}
                </button>
              </div>
            </div>
          ) : null
        }
      >
        {editing ? (
          <div className="space-y-5">
            {blockers.length ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Bu markaya {blockers.join(" ve ")} bağlı; silmek için önce bu bağlantıları kaldırın.
              </p>
            ) : null}
            <BrandForm key={editing.id} formId="brand-edit-form" mode="edit" brand={editing} onSaved={onSaved} onBusyChange={setFormBusy} />
            <dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-xs">
              <div><dt className="text-slate-500">Ürün</dt><dd className="mt-0.5 font-medium text-slate-800">{editing.productCount}</dd></div>
              <div><dt className="text-slate-500">Hikaye</dt><dd className="mt-0.5 font-medium text-slate-800">{editing.storyCount}</dd></div>
              <div><dt className="text-slate-500">Oluşturulma</dt><dd className="mt-0.5 font-medium text-slate-800">{dt.format(new Date(editing.createdAt))}</dd></div>
              <div><dt className="text-slate-500">Son güncelleme</dt><dd className="mt-0.5 font-medium text-slate-800">{dt.format(new Date(editing.updatedAt))}</dd></div>
              <div className="col-span-2"><dt className="text-slate-500">Kimlik (id)</dt><dd className="mt-0.5 break-all font-mono text-slate-700">{editing.id}</dd></div>
            </dl>
          </div>
        ) : null}
      </AdminDrawer>

      <AdminConfirmDialog
        open={confirmOpen}
        title="Marka silinsin mi?"
        description={editing ? `"${editing.name}" kalıcı olarak silinecek. Kampanya hedefleri ve SEO kayıtları da kaldırılır, menü bağlantıları boşa düşer.` : undefined}
        confirmLabel="Evet, sil"
        busyLabel="Siliniyor…"
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
