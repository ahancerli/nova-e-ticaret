"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Lock, Plus, Save, ShieldAlert, Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminBadge, AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Field, inputCls } from "@/components/admin/form";
import { ADMIN_ROLE, PERMISSION_GROUPS } from "@/modules/staff/domain/permissions";
import type { RoleRow } from "@/modules/staff";
import { rolesApi } from "./api";

type Draft = { id: string | null; name: string; description: string; permissions: string[]; updatedAt: string };
const draftOf = (r: RoleRow): Draft => ({ id: r.id, name: r.name, description: r.description ?? "", permissions: [...r.permissions].sort(), updatedAt: r.updatedAt });
const NEW: Draft = { id: null, name: "", description: "", permissions: [], updatedAt: "" };

/** Roller ve yetkiler: role list on the left, permission matrix of the selected role on the right. */
export function RolesManager({ roles }: { roles: RoleRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(roles[0]?.id ?? null);
  const role = roles.find((r) => r.id === selected) ?? null;
  const [draft, setDraft] = useState<Draft>(() => (role ? draftOf(role) : NEW));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const errors = useFieldErrors();
  const fe = errors.get;

  const base = draft.id ? (role ? draftOf(role) : NEW) : NEW;
  const dirty = JSON.stringify({ ...draft, permissions: [...draft.permissions].sort() }) !== JSON.stringify(base);
  const locked = role?.code === ADMIN_ROLE && draft.id !== null;
  const perms = useMemo(() => new Set(draft.permissions), [draft.permissions]);

  const pick = (r: RoleRow | null) => {
    errors.clear();
    setSelected(r?.id ?? null);
    setDraft(r ? draftOf(r) : NEW);
  };
  const toggle = (code: string, on: boolean) => setDraft((d) => ({ ...d, permissions: on ? [...d.permissions, code] : d.permissions.filter((p) => p !== code) }));
  const toggleGroup = (codes: string[], on: boolean) =>
    setDraft((d) => ({ ...d, permissions: on ? [...new Set([...d.permissions, ...codes])] : d.permissions.filter((p) => !codes.includes(p)) }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    errors.clear();
    const input = { name: draft.name, description: draft.description || null, permissions: draft.permissions };
    try {
      if (draft.id) {
        const r = await rolesApi.update(draft.id, { ...input, expectedUpdatedAt: draft.updatedAt });
        setDraft((d) => ({ ...d, updatedAt: r.data.updatedAt }));
        notify.success("Rol güncellendi", { description: draft.name });
      } else {
        const r = await rolesApi.create(input);
        notify.success("Rol oluşturuldu", { description: draft.name });
        setSelected(r.data.id);
        setDraft((d) => ({ ...d, id: r.data.id, updatedAt: r.data.updatedAt, permissions: [...d.permissions].sort() }));
      }
      router.refresh();
    } catch (err) {
      const n = errors.fromError(err);
      notify.error(err, { description: n ? "İşaretli alanları kontrol edin." : undefined });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft.id) return;
    try {
      await rolesApi.remove(draft.id);
      notify.success("Rol silindi", { description: draft.name });
      setConfirmDelete(false);
      pick(roles.find((r) => r.id !== draft.id) ?? null);
      router.refresh();
    } catch (err) {
      notify.error(err);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/kullanicilar" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" />Kullanıcılar</Link>
        <AdminPageHeader title="Roller ve yetkiler" subtitle="Rol, bir yetki paketidir. Kullanıcılara bir veya birden çok rol atanır; yetkiler birleşir." />
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <AdminCard className="self-start overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {roles.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => pick(r)} aria-current={selected === r.id && draft.id ? "true" : undefined}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${selected === r.id && draft.id ? "bg-[#7367f0]/5" : "hover:bg-slate-50"}`}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">{r.name}{r.isSystem ? <Lock className="size-3 text-slate-400" aria-label="Hazır rol" /> : null}</span>
                    <span className="block text-xs text-slate-500">{r.permissions.length} yetki · {r.userCount} kullanıcı</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-100 p-3">
            <button type="button" onClick={() => pick(null)} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 text-sm font-medium text-[#5b4fe0] hover:bg-slate-50">
              <Plus className="size-4" />Rol ekle
            </button>
          </div>
        </AdminCard>

        <form onSubmit={save} noValidate className="min-w-0 space-y-4">
          <AdminCard className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">{draft.id ? draft.name || "Rol" : "Yeni rol"}</h2>
              {role?.isSystem && draft.id ? <AdminBadge tone="slate">Hazır rol</AdminBadge> : null}
              {draft.id && role ? <AdminBadge tone="purple">{role.userCount} kullanıcı</AdminBadge> : null}
            </div>
            {locked ? (
              <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600"><Lock className="mt-0.5 size-4 flex-none" aria-hidden />Yönetici rolü her zaman tüm yetkilere sahiptir; yetkileri değiştirilemez.</p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="role-name" label="Rol adı" required error={fe("name")}>
                <input id="role-name" className={inputCls} value={draft.name} maxLength={80} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} aria-invalid={!!fe("name")} />
              </Field>
              <Field id="role-desc" label="Açıklama" error={fe("description")}>
                <input id="role-desc" className={inputCls} value={draft.description} maxLength={300} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />
              </Field>
            </div>
          </AdminCard>

          <AdminCard className="overflow-hidden">
            {fe("permissions") ? <p className="px-5 pt-4 text-xs text-red-600">{fe("permissions")}</p> : null}
            {PERMISSION_GROUPS.map((g) => {
              const codes = g.permissions.map((p) => p.code);
              const all = codes.every((c) => perms.has(c));
              return (
                <fieldset key={g.key} className="border-b border-slate-100 last:border-b-0">
                  <legend className="sr-only">{g.label}</legend>
                  <div className="flex items-center justify-between bg-slate-50/70 px-5 py-2.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.label}</span>
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input type="checkbox" className="size-4 accent-[#7367f0]" checked={all} disabled={locked} onChange={(e) => toggleGroup(codes, e.target.checked)} />
                      Tümü
                    </label>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {g.permissions.map((p) => (
                      <li key={p.code}>
                        <label className={`flex items-start gap-3 px-5 py-3 ${locked ? "" : "cursor-pointer hover:bg-slate-50/60"}`}>
                          <input type="checkbox" className="mt-0.5 size-4 flex-none accent-[#7367f0]" checked={perms.has(p.code)} disabled={locked} onChange={(e) => toggle(p.code, e.target.checked)} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                              {p.label}
                              {p.sensitive ? <ShieldAlert className="size-3.5 text-amber-500" aria-label="Hassas yetki" /> : null}
                            </span>
                            <span className="block text-xs text-slate-500">{p.description}</span>
                          </span>
                          <code className="hidden flex-none font-mono text-[11px] text-slate-400 sm:block">{p.code}</code>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              );
            })}
          </AdminCard>

          <div className="sticky bottom-4 z-30">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
              {draft.id && !role?.isSystem ? (
                <button type="button" onClick={() => setConfirmDelete(true)} disabled={(role?.userCount ?? 0) > 0}
                  title={(role?.userCount ?? 0) > 0 ? "Bu rol kullanıcılara atanmış." : undefined}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                  <Trash2 className="size-4" />Sil
                </button>
              ) : <span className="text-sm text-slate-500">{dirty ? "Kaydedilmemiş değişiklikler var." : ""}</span>}
              <button type="submit" disabled={saving || !draft.name.trim() || (!!draft.id && !dirty)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60">
                <Save className="size-4" />{saving ? "Bekleyin…" : draft.id ? "Güncelle" : "Rolü oluştur"}
              </button>
            </div>
          </div>
        </form>
      </div>

      <AdminConfirmDialog open={confirmDelete} title="Rol silinsin mi?" description={`“${draft.name}” rolü kalıcı olarak silinecek.`} confirmLabel="Evet, sil"
        onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
    </div>
  );
}
