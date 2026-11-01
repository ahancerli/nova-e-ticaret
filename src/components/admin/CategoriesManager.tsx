"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FolderPlus, Save, Trash2 } from "lucide-react";
import { api, ClientApiError } from "@/lib/api-client";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "./ui";

type Node = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  childCount: number;
  depth: number;
  path: string;
  children: Node[];
};

type TreeResponse = { tree: Node[]; flat: Node[] };

export function CategoriesManager({ initial }: { initial: TreeResponse }) {
  const router = useRouter();
  const [data, setData] = useState<TreeResponse>(initial);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(initial.flat.filter((n) => n.depth === 0).map((n) => n.id)));
  const [selectedId, setSelectedId] = useState<string | null>(initial.flat[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => data.flat.find((n) => n.id === selectedId) ?? null, [data, selectedId]);
  const [form, setForm] = useState({
    mode: "create" as "create" | "edit",
    name: "",
    slug: "",
    parentId: "" as string,
    description: "",
    sortOrder: 0,
    isActive: true,
  });

  const refresh = async (nextSelected?: string | null) => {
    const r = await api<TreeResponse>("/api/admin/categories");
    setData(r.data);
    const id = nextSelected ?? selectedId;
    setSelectedId(id && r.data.flat.some((n) => n.id === id) ? id : r.data.flat[0]?.id ?? null);
  };

  const openCreate = (parentId?: string | null) => {
    setForm({
      mode: "create",
      name: "",
      slug: "",
      parentId: parentId ?? "",
      description: "",
      sortOrder: 0,
      isActive: true,
    });
    setError(null);
  };

  const openEdit = () => {
    if (!selected) return;
    setForm({
      mode: "edit",
      name: selected.name,
      slug: selected.slug,
      parentId: selected.parentId ?? "",
      description: selected.description ?? "",
      sortOrder: selected.sortOrder,
      isActive: selected.isActive,
    });
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        slug: form.slug || undefined,
        parentId: form.parentId || null,
        description: form.description || null,
        sortOrder: form.sortOrder,
        isActive: form.isActive,
      };
      if (form.mode === "create") {
        const r = await api<{ id: string }>("/api/admin/categories", { method: "POST", json: payload });
        await refresh(r.data.id);
      } else if (selected) {
        await api(`/api/admin/categories/${selected.id}`, { method: "PUT", json: payload });
        await refresh(selected.id);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "İşlem başarısız.");
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = async () => {
    if (!selected || busy) return;
    if (!confirm(`"${selected.name}" kategorisi silinsin mi?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/categories/${selected.id}`, { method: "DELETE" });
      await refresh(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "Silme başarısız.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Kategori yönetimi"
        subtitle="Kategori ağacı, kategori detayları ve CRUD işlemleri."
        actions={
          <button type="button" onClick={() => openCreate(null)} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#7367f0] px-3 text-sm font-medium text-white hover:bg-[#6559df]">
            <FolderPlus className="h-4 w-4" />
            Yeni kök kategori
          </button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <AdminCard>
          <AdminCardTitle title={`Kategori ağacı (${data.flat.length})`} subtitle="İç içe kategori yapısı" />
          <div className="p-4">
            {data.tree.length === 0 ? <p className="text-sm text-slate-500">Henüz kategori yok.</p> : data.tree.map((n) => (
              <TreeNode
                key={n.id}
                node={n}
                selectedId={selectedId}
                expanded={expanded}
                onSelect={(id) => setSelectedId(id)}
                onToggle={(id) =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onQuickAdd={(id) => openCreate(id)}
              />
            ))}
          </div>
        </AdminCard>

        <div className="space-y-4">
          <AdminCard>
            <AdminCardTitle
              title={form.mode === "create" ? "Kategori ekle" : "Kategori düzenle"}
              subtitle={form.mode === "create" ? "Yeni kategori için alanları doldurun." : selected?.path ?? ""}
              actions={
                form.mode === "edit" && selected ? (
                  <Link href={`/admin/kategoriler/${selected.id}`} className="text-sm text-[#7367f0] hover:underline">
                    Detay sayfası
                  </Link>
                ) : null
              }
            />
            <div className="space-y-3 p-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Ad</span>
                <input className="input border-slate-200" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Slug (boşsa otomatik)</span>
                <input className="input border-slate-200" value={form.slug} onChange={(e) => setForm((s) => ({ ...s, slug: e.target.value }))} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Üst kategori</span>
                <select className="input border-slate-200" value={form.parentId} onChange={(e) => setForm((s) => ({ ...s, parentId: e.target.value }))}>
                  <option value="">(Kök kategori)</option>
                  {data.flat
                    .filter((x) => !(form.mode === "edit" && selected && x.id === selected.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>{"— ".repeat(c.depth)}{c.name}</option>
                    ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Sıra</span>
                <input type="number" className="input border-slate-200" value={form.sortOrder} onChange={(e) => setForm((s) => ({ ...s, sortOrder: Number(e.target.value) }))} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Açıklama</span>
                <textarea className="input min-h-24 border-slate-200 py-2" value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="size-4 accent-[#7367f0]" checked={form.isActive} onChange={(e) => setForm((s) => ({ ...s, isActive: e.target.checked }))} />
                Aktif
              </label>

              {error ? <p className="text-sm text-red-600">{error}</p> : null}

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={submit} disabled={busy || form.name.trim().length < 2} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#7367f0] px-3 text-sm font-medium text-white hover:bg-[#6559df] disabled:opacity-60">
                  <Save className="h-4 w-4" />
                  {form.mode === "create" ? "Kategoriyi ekle" : "Güncelle"}
                </button>
                {form.mode === "edit" ? (
                  <button type="button" onClick={removeSelected} disabled={busy || !selected} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60">
                    <Trash2 className="h-4 w-4" />
                    Sil
                  </button>
                ) : null}
                {selected ? (
                  <button type="button" onClick={openEdit} className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    Seçiliyi düzenle
                  </button>
                ) : null}
              </div>
            </div>
          </AdminCard>

          {selected ? (
            <AdminCard className="p-4">
              <h3 className="text-sm font-semibold text-slate-800">{selected.name}</h3>
              <p className="mt-1 text-xs text-slate-500">{selected.path}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <AdminBadge tone={selected.isActive ? "green" : "slate"}>{selected.isActive ? "Aktif" : "Pasif"}</AdminBadge>
                <AdminBadge tone="blue">Ürün: {selected.productCount}</AdminBadge>
                <AdminBadge tone="purple">Alt kategori: {selected.childCount}</AdminBadge>
              </div>
            </AdminCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TreeNode({
  node,
  selectedId,
  expanded,
  onSelect,
  onToggle,
  onQuickAdd,
}: {
  node: Node;
  selectedId: string | null;
  expanded: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onQuickAdd: (id: string) => void;
}) {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  return (
    <div className="select-none">
      <div className={`mb-1 flex items-center justify-between rounded-lg px-2 py-1.5 text-sm ${selectedId === node.id ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-50"}`}>
        <button type="button" className="flex min-w-0 items-center gap-2" onClick={() => onSelect(node.id)}>
          {hasChildren ? (
            <span onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}>
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
          ) : <span className="w-4" />}
          <span className="truncate">{node.name}</span>
        </button>
        <div className="flex items-center gap-1">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{node.productCount}</span>
          <button type="button" onClick={() => onQuickAdd(node.id)} className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700">+ alt</button>
        </div>
      </div>
      {hasChildren && isOpen ? (
        <div className="ml-4 border-l border-slate-200 pl-2">
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} selectedId={selectedId} expanded={expanded} onSelect={onSelect} onToggle={onToggle} onQuickAdd={onQuickAdd} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

