"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Info, KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { DataGrid, type GridColumn } from "@/components/ui/DataGrid";
import { AdminBadge, AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { AdminFormDialog } from "@/components/admin/AdminFormDialog";
import { OneTimeLinkDialog } from "@/components/admin/OneTimeLinkDialog";
import { Field, inputCls } from "@/components/admin/form";
import { STAFF_STATES, type RoleRow, type StaffState, type StaffSummary } from "@/modules/staff/domain/staff";
import { staffApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
const TABS: { key: "all" | StaffState; label: string }[] = [
  { key: "all", label: "Tümü" }, { key: "active", label: "Aktif" }, { key: "invited", label: "Davet bekleyen" }, { key: "suspended", label: "Askıda" },
];

/** Kullanıcılar: panel users with state tabs; invite opens a dialog and returns a one-time link. */
export function StaffManager({ initial, roles, currentUserId }: { initial: StaffSummary[]; roles: RoleRow[]; currentUserId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<"all" | StaffState>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [link, setLink] = useState<{ path: string; expiresAt: string; name: string } | null>(null);

  const counts = useMemo(() => initial.reduce<Record<string, number>>((a, s) => ({ ...a, [s.state]: (a[s.state] ?? 0) + 1 }), {}), [initial]);
  const rows = tab === "all" ? initial : initial.filter((s) => s.state === tab);

  const columns = useMemo<GridColumn<StaffSummary>[]>(() => [
    {
      colId: "name", field: "displayName", headerName: "Kullanıcı", flex: 1, minWidth: 260, sortable: true,
      cellRenderer: (p: { data?: StaffSummary }) => p.data ? (
        <span className="flex h-full items-center gap-3">
          <span className="grid size-9 flex-none place-items-center rounded-full bg-[#7367f0]/10 text-xs font-semibold text-[#5b4fe0]">
            {p.data.displayName.split(/\s+/).slice(0, 2).map((x) => x[0]?.toLocaleUpperCase("tr-TR")).join("")}
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-medium text-slate-800">{p.data.displayName}{p.data.id === currentUserId ? <span className="ml-1.5 text-xs font-normal text-slate-400">(siz)</span> : null}</span>
            <span className="truncate text-xs text-slate-500">{p.data.email}</span>
          </span>
        </span>
      ) : null,
    },
    {
      colId: "roles", headerName: "Roller", minWidth: 220, valueGetter: (p) => p.data?.roles.map((r) => r.name).join(", ") ?? "",
      cellRenderer: (p: { data?: StaffSummary }) => p.data ? (
        <span className="flex h-full flex-wrap items-center gap-1">{p.data.roles.map((r) => <AdminBadge key={r.id} tone="purple">{r.name}</AdminBadge>)}</span>
      ) : null,
    },
    { colId: "jobTitle", field: "jobTitle", headerName: "Görev", minWidth: 150, valueFormatter: (p) => p.value || "—" },
    {
      colId: "state", field: "state", headerName: "Durum", minWidth: 150, sortable: true,
      cellRenderer: (p: { data?: StaffSummary }) => p.data ? <AdminBadge tone={STAFF_STATES[p.data.state].tone}>{STAFF_STATES[p.data.state].label}</AdminBadge> : null,
    },
    { colId: "lastLoginAt", field: "lastLoginAt", headerName: "Son giriş", minWidth: 170, sortable: true, valueFormatter: (p) => (p.value ? dt.format(new Date(p.value)) : "Hiç giriş yapmadı") },
  ], [currentUserId]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Kullanıcılar"
        subtitle="Yönetim paneline erişebilen ekip üyeleri. Parolayı herkes kendisi belirler; siz yalnız davet eder ve rol atarsınız."
        actions={
          <>
            <Link href="/admin/kullanicilar/roller" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <ShieldCheck className="size-4" />Roller ve yetkiler
            </Link>
            <button type="button" onClick={() => setInviteOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df]">
              <UserPlus className="size-4" />Kullanıcı davet et
            </button>
          </>
        }
      />

      <p className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Info className="mt-0.5 size-4 flex-none" aria-hidden />
        <span>Panel hesapları ile mağaza (müşteri) hesapları ayrıdır: panel hesabıyla mağazada alışveriş yapılmaz. Ekipten biri alışveriş yapacaksa farklı bir e-postayla mağazadan üye olur.</span>
      </p>

      <AdminCard className="overflow-hidden">
        <div role="tablist" aria-label="Durum" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-slate-200 px-3 pt-2 sm:px-4">
          {TABS.map((t) => {
            const on = t.key === tab;
            const n = t.key === "all" ? initial.length : counts[t.key] ?? 0;
            return (
              <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)}
                className={`relative flex flex-none items-center gap-2 px-3 py-3 text-sm ${on ? "font-semibold text-[#5b4fe0]" : "text-slate-500 hover:text-slate-800"}`}>
                {t.label}
                <span className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums ${on ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-500"}`}>{n}</span>
                <span className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#7367f0] transition-transform ${on ? "scale-x-100" : "scale-x-0"}`} aria-hidden />
              </button>
            );
          })}
        </div>
        <DataGrid<StaffSummary>
          columns={columns} rows={rows} getRowId={(s) => s.id} onRowClick={(s) => router.push(`/admin/kullanicilar/${s.id}`)}
          stateKey="admin-staff" exportFileName="panel-kullanicilari" searchPlaceholder="Ad, e-posta veya rol ara" emptyText="Bu durumda kullanıcı yok." height={480}
        />
      </AdminCard>

      <InviteDialog open={inviteOpen} roles={roles} onClose={() => setInviteOpen(false)}
        onInvited={(r, name) => { setInviteOpen(false); setLink({ ...r.link, name }); router.refresh(); }} />
      <OneTimeLinkDialog link={link} title="Davet bağlantısı hazır" recipient={link?.name ?? ""} onClose={() => setLink(null)} />
    </div>
  );
}

function InviteDialog({ open, roles, onClose, onInvited }: {
  open: boolean;
  roles: RoleRow[];
  onClose: () => void;
  onInvited: (r: { id: string; link: { path: string; expiresAt: string } }, name: string) => void;
}) {
  const empty = { email: "", displayName: "", phone: "", jobTitle: "", department: "", roleIds: [] as string[] };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const errors = useFieldErrors();
  const fe = errors.get;
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));

  const submit = async () => {
    setBusy(true);
    errors.clear();
    try {
      const r = await staffApi.invite({ ...f, phone: f.phone || null, jobTitle: f.jobTitle || null, department: f.department || null });
      notify.success("Kullanıcı davet edildi", { description: f.email });
      onInvited(r.data, f.displayName);
      setF(empty);
    } catch (err) {
      const n = errors.fromError(err);
      notify.error(err, { description: n ? "İşaretli alanları kontrol edin." : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminFormDialog open={open} title="Kullanıcı davet et" icon={KeyRound} submitLabel="Davet bağlantısı oluştur" busyLabel="Oluşturuluyor…" busy={busy}
      description="Hesap parolasız açılır; kişi 7 gün geçerli davet bağlantısıyla kendi parolasını belirler."
      submitDisabled={!f.email.trim() || !f.displayName.trim() || f.roleIds.length === 0} onSubmit={submit} onCancel={() => { errors.clear(); onClose(); }}>
      <Field id="inv-name" label="Ad soyad" required error={fe("displayName")}>
        <input id="inv-name" className={inputCls} value={f.displayName} maxLength={120} autoFocus onChange={(e) => set({ displayName: e.target.value })} aria-invalid={!!fe("displayName")} />
      </Field>
      <Field id="inv-email" label="İş e-postası" required error={fe("email")}>
        <input id="inv-email" type="email" className={inputCls} value={f.email} maxLength={254} onChange={(e) => set({ email: e.target.value })} aria-invalid={!!fe("email")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="inv-title" label="Görev" error={fe("jobTitle")}>
          <input id="inv-title" className={inputCls} value={f.jobTitle} maxLength={80} placeholder="ör. Depo sorumlusu" onChange={(e) => set({ jobTitle: e.target.value })} />
        </Field>
        <Field id="inv-phone" label="Telefon" error={fe("phone")}>
          <input id="inv-phone" type="tel" className={inputCls} value={f.phone} maxLength={20} placeholder="+90 5xx…" onChange={(e) => set({ phone: e.target.value })} aria-invalid={!!fe("phone")} />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 block text-xs font-medium text-slate-600">Roller <span className="text-red-500" aria-hidden>*</span></legend>
        <RolePicker roles={roles} value={f.roleIds} onChange={(roleIds) => set({ roleIds })} />
        {fe("roleIds") ? <p className="mt-1 text-xs text-red-600">{fe("roleIds")}</p> : null}
      </fieldset>
    </AdminFormDialog>
  );
}

/** Checkbox list of staff roles with their description. */
export function RolePicker({ roles, value, onChange }: { roles: RoleRow[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="max-h-56 space-y-1.5 overflow-y-auto">
      {roles.map((r) => {
        const on = value.includes(r.id);
        return (
          <label key={r.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 ${on ? "border-[#7367f0] bg-[#7367f0]/5" : "border-slate-200 hover:bg-slate-50"}`}>
            <input type="checkbox" className="mt-0.5 size-4 flex-none accent-[#7367f0]" checked={on}
              onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))} />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-800">{r.name}</span>
              {r.description ? <span className="block text-xs text-slate-500">{r.description}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
