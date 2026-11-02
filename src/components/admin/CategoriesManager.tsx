"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, FolderTree, Plus, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { notify } from "@/lib/toast";
import type { CategoryNode } from "@/server/services/admin-categories";
import { Collapsible } from "@/components/ui/Collapsible";
import { AdminBadge, AdminCard, AdminPageHeader } from "./ui";
import { AdminDrawer } from "./AdminDrawer";
import { AdminConfirmDialog } from "./AdminConfirmDialog";
import { CategoryForm } from "./CategoryForm";

type TreeResponse = { tree: CategoryNode[]; flat: CategoryNode[] };

const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });

/** Ids of `id` and all its ancestors, so a freshly created node is visible in the tree. */
function ancestorsOf(flat: CategoryNode[], id: string): string[] {
  const byId = new Map(flat.map((n) => [n.id, n]));
  const out: string[] = [];
  for (let cur = byId.get(id); cur?.parentId; cur = byId.get(cur.parentId)) out.push(cur.parentId);
  return out;
}

export function CategoriesManager({ initial, createdId }: { initial: TreeResponse; createdId: string | null }) {
  const [data, setData] = useState<TreeResponse>(initial);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([...initial.flat.filter((n) => n.depth === 0).map((n) => n.id), ...(createdId ? ancestorsOf(initial.flat, createdId) : [])]),
  );
  // editingId outlives `drawerOpen` so the drawer keeps its content during the slide-out animation.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(createdId);
  const [formBusy, setFormBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!createdId) return;
    const created = initial.flat.find((n) => n.id === createdId);
    // Fixed id: effects may run twice in dev; Sonner de-duplicates by id.
    if (created) notify.success("Kategori eklendi", { id: `category-created-${createdId}`, description: created.path });
    // Drop ?eklendi=… without re-rendering the server page.
    window.history.replaceState(null, "", window.location.pathname);
  }, [createdId, initial.flat]);

  const editing = useMemo(() => data.flat.find((n) => n.id === editingId) ?? null, [data, editingId]);

  // A category cannot move under itself or one of its own descendants.
  const parentOptions = useMemo(() => {
    if (!editing) return data.flat;
    const blocked = new Set<string>();
    const walk = (n: CategoryNode) => { blocked.add(n.id); n.children.forEach(walk); };
    walk(editing);
    return data.flat.filter((n) => !blocked.has(n.id));
  }, [data, editing]);

  const reload = useCallback(async () => {
    const r = await api<TreeResponse>("/api/admin/categories");
    setData(r.data);
  }, []);

  const openEditor = (id: string) => {
    setEditingId(id);
    setHighlightId(id);
    setDrawerOpen(true);
  };
  const closeEditor = useCallback(() => setDrawerOpen(false), []);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onSaved = async (id: string) => {
    await reload();
    setDrawerOpen(false);
    setHighlightId(id);
    notify.success("Kategori güncellendi", { description: data.flat.find((n) => n.id === id)?.name });
  };

  const remove = async () => {
    if (!editing) return;
    const { id, name } = editing;
    setDeleting(true);
    try {
      await api(`/api/admin/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
      setConfirmOpen(false);
      setDrawerOpen(false);
      setHighlightId(null);
      await reload();
      notify.success("Kategori silindi", { description: name });
    } catch (err) {
      setConfirmOpen(false);
      notify.error(err, { fallback: "Kategori silinemedi." });
    } finally {
      setDeleting(false);
    }
  };

  const canDelete = editing ? editing.childCount === 0 && editing.productCount === 0 : false;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Kategoriler"
        subtitle={`${data.flat.length} kategori · düzenlemek için bir kategoriye tıklayın`}
        actions={
          <Link href="/admin/kategoriler/yeni" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 transition hover:-translate-y-px hover:bg-[#6559df] hover:shadow-md hover:shadow-[#7367f0]/30">
            <Plus className="h-4 w-4" />
            Kategori ekle
          </Link>
        }
      />

      <AdminCard>
        {data.tree.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <FolderTree className="h-10 w-10 text-slate-300" />
            <p className="text-sm text-slate-500">Henüz kategori yok. Başlamak için üstten “Kategori ekle”yi kullanın.</p>
          </div>
        ) : (
          <ul role="tree" aria-label="Kategori ağacı" className="p-2 sm:p-3">
            {data.tree.map((n) => (
              <TreeNode key={n.id} node={n} expanded={expanded} activeId={drawerOpen ? editingId : highlightId} onToggle={toggle} onOpen={openEditor} />
            ))}
          </ul>
        )}
      </AdminCard>

      <AdminDrawer
        open={drawerOpen && !!editing}
        onClose={closeEditor}
        title={editing ? `${editing.name} düzenle` : "Kategori düzenle"}
        subtitle={editing?.path}
        footer={
          editing ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canDelete || deleting || formBusy}
                title={canDelete ? undefined : "Alt kategorisi veya ürünü olan kategori silinemez."}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                <Trash2 className="h-4 w-4" />
                Sil
              </button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button type="button" onClick={closeEditor} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                  Vazgeç
                </button>
                <button type="submit" form="category-edit-form" disabled={formBusy || deleting}
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
            <CategoryForm
              key={editing.id}
              formId="category-edit-form"
              mode="edit"
              category={editing}
              parents={parentOptions}
              onSaved={onSaved}
              onBusyChange={setFormBusy}
            />
            <dl className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-xs">
              <div><dt className="text-slate-500">Ürün bağlantısı</dt><dd className="mt-0.5 font-medium text-slate-800">{editing.productCount}</dd></div>
              <div><dt className="text-slate-500">Alt kategori</dt><dd className="mt-0.5 font-medium text-slate-800">{editing.childCount}</dd></div>
              <div><dt className="text-slate-500">Oluşturulma</dt><dd className="mt-0.5 font-medium text-slate-800">{dt.format(new Date(editing.createdAt))}</dd></div>
              <div><dt className="text-slate-500">Son güncelleme</dt><dd className="mt-0.5 font-medium text-slate-800">{dt.format(new Date(editing.updatedAt))}</dd></div>
              <div className="col-span-2"><dt className="text-slate-500">Kimlik (id)</dt><dd className="mt-0.5 break-all font-mono text-slate-700">{editing.id}</dd></div>
            </dl>
          </div>
        ) : null}
      </AdminDrawer>

      <AdminConfirmDialog
        open={confirmOpen}
        title="Kategori silinsin mi?"
        description={editing ? `"${editing.name}" kalıcı olarak silinecek. Bu işlem geri alınamaz.` : undefined}
        confirmLabel="Evet, sil"
        busyLabel="Siliniyor…"
        busy={deleting}
        onConfirm={remove}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function TreeNode({
  node,
  expanded,
  activeId,
  onToggle,
  onOpen,
}: {
  node: CategoryNode;
  expanded: Set<string>;
  activeId: string | null;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = hasChildren && expanded.has(node.id);
  const active = activeId === node.id;
  return (
    <li role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={active}>
      <div className={`group flex min-h-12 items-center gap-1 rounded-lg pr-2 transition-colors duration-200 ${active ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-slate-50"}`}>
        {hasChildren ? (
          <button type="button" onClick={() => onToggle(node.id)} aria-label={`${node.name} ${isOpen ? "daralt" : "genişlet"}`}
            className="inline-flex size-9 flex-none items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-200/60 hover:text-slate-700">
            <ChevronRight className={`h-4 w-4 transition-transform duration-300 ease-out-expo ${isOpen ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="size-9 flex-none" aria-hidden />
        )}
        <button type="button" onClick={() => onOpen(node.id)} className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left">
          <span className="grid size-9 flex-none place-items-center overflow-hidden rounded-lg bg-slate-100 transition-transform duration-200 group-hover:scale-105">
            {node.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={node.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <FolderTree className="h-4 w-4 text-slate-400" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-sm font-medium ${node.isActive ? "text-slate-800" : "text-slate-400"}`}>{node.name}</span>
            <span className="block truncate font-mono text-xs text-slate-400">/{node.slug}</span>
          </span>
          <span className="hidden flex-none text-xs tabular-nums text-slate-500 sm:inline">{node.productCount} ürün</span>
          {node.isActive ? null : <AdminBadge tone="slate">Pasif</AdminBadge>}
        </button>
      </div>
      {hasChildren ? (
        <Collapsible open={isOpen}>
          <ul role="group" className="ml-4 border-l border-slate-200 pl-1 sm:ml-5 sm:pl-2">
            {node.children.map((c) => (
              <TreeNode key={c.id} node={c} expanded={expanded} activeId={activeId} onToggle={onToggle} onOpen={onOpen} />
            ))}
          </ul>
        </Collapsible>
      ) : null}
    </li>
  );
}
