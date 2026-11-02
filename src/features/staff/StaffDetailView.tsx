"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Ban, KeyRound, LogOut, MailPlus, RotateCcw, Save, Trash2, UserCheck } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { OneTimeLinkDialog } from "@/components/admin/OneTimeLinkDialog";
import { Field, inputCls } from "@/components/admin/form";
import { PERMISSION_GROUPS } from "@/modules/staff/domain/permissions";
import { STAFF_STATES, type RoleRow, type StaffDetail } from "@/modules/staff/domain/staff";
import type { StaffAction } from "@/modules/staff";
import { staffApi } from "./api";
import { RolePicker } from "./StaffManager";

const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
const fmt = (iso: string | null, empty = "—") => (iso ? dt.format(new Date(iso)) : empty);

const CONFIRM: Partial<Record<StaffAction, { title: string; description: string; label: string; tone: "danger" | "primary" }>> = {
  suspend: { title: "Kullanıcı askıya alınsın mı?", description: "Panele giremez; açık oturumları hemen kapatılır. İstediğiniz zaman yeniden etkinleştirebilirsiniz.", label: "Askıya al", tone: "danger" },
  revoke_sessions: { title: "Tüm oturumlar kapatılsın mı?", description: "Kullanıcı bütün cihazlarda panelden çıkarılır; parolasıyla yeniden giriş yapabilir.", label: "Oturumları kapat", tone: "primary" },
  cancel_invite: { title: "Davet iptal edilsin mi?", description: "Hesap silinir ve davet bağlantısı çalışmaz olur.", label: "Daveti iptal et", tone: "danger" },
};

const DONE: Partial<Record<StaffAction, string>> = {
  suspend: "Kullanıcı askıya alındı", reactivate: "Kullanıcı yeniden etkinleştirildi", revoke_sessions: "Tüm oturumlar kapatıldı",
};

/** One panel user: profile + roles (with the resulting permissions), account actions and open sessions. */
export function StaffDetailView({ staff, roles, currentUserId }: { staff: StaffDetail; roles: RoleRow[]; currentUserId: string }) {
  const router = useRouter();
  const self = staff.id === currentUserId;
  const initial = useMemo(() => ({
    displayName: staff.displayName, phone: staff.phone ?? "", jobTitle: staff.jobTitle ?? "", department: staff.department ?? "", roleIds: staff.roles.map((r) => r.id).sort(),
  }), [staff]);
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<StaffAction | null>(null);
  const [confirm, setConfirm] = useState<StaffAction | null>(null);
  const [link, setLink] = useState<{ path: string; expiresAt: string } | null>(null);
  const [linkTitle, setLinkTitle] = useState("");
  const errors = useFieldErrors();
  const fe = errors.get;
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));
  const dirty = JSON.stringify({ ...f, roleIds: [...f.roleIds].sort() }) !== JSON.stringify(initial);

  // Permissions the selected roles would grant (preview before saving).
  const granted = useMemo(() => new Set(roles.filter((r) => f.roleIds.includes(r.id)).flatMap((r) => r.permissions)), [roles, f.roleIds]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    errors.clear();
    try {
      await staffApi.update(staff.id, { displayName: f.displayName, phone: f.phone || null, jobTitle: f.jobTitle || null, department: f.department || null, roleIds: f.roleIds });
      notify.success("Kullanıcı güncellendi", { description: f.displayName });
      router.refresh();
    } catch (err) {
      const n = errors.fromError(err);
      notify.error(err, { description: n ? "İşaretli alanları kontrol edin." : undefined });
    } finally {
      setSaving(false);
    }
  };

  const run = async (action: StaffAction) => {
    setBusyAction(action);
    try {
      const r = await staffApi.action(staff.id, action);
      setConfirm(null);
      if (action === "cancel_invite") {
        notify.success("Davet iptal edildi");
        router.push("/admin/kullanicilar");
        router.refresh();
        return;
      }
      if (r.data.link) {
        setLinkTitle(action === "resend_invite" ? "Yeni davet bağlantısı" : "Parola sıfırlama bağlantısı");
        setLink(r.data.link);
      } else {
        notify.success(DONE[action] ?? "İşlem tamamlandı");
      }
      router.refresh();
    } catch (err) {
      notify.error(err);
      setConfirm(null);
    } finally {
      setBusyAction(null);
    }
  };
  const ask = (action: StaffAction) => (CONFIRM[action] ? setConfirm(action) : run(action));
  const state = STAFF_STATES[staff.state];
  const btn = "inline-flex min-h-10 w-full items-center gap-2 rounded-lg border border-slate-200 px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/kullanicilar" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" />Kullanıcılar</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{staff.displayName}</h1>
          <AdminBadge tone={state.tone}>{state.label}</AdminBadge>
          {self ? <AdminBadge tone="blue">Siz</AdminBadge> : null}
        </div>
        <p className="mt-1 text-sm text-slate-500">{staff.email}{staff.jobTitle ? ` · ${staff.jobTitle}` : ""}</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <form onSubmit={save} noValidate className="min-w-0 space-y-6">
          <AdminCard>
            <AdminCardTitle title="Profil" subtitle="E-posta giriş kimliğidir ve değiştirilemez; farklı e-posta için yeni davet gönderin." />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <Field id="st-name" label="Ad soyad" required error={fe("displayName")} className="sm:col-span-2">
                <input id="st-name" className={inputCls} value={f.displayName} maxLength={120} onChange={(e) => set({ displayName: e.target.value })} aria-invalid={!!fe("displayName")} />
              </Field>
              <Field id="st-title" label="Görev" error={fe("jobTitle")}>
                <input id="st-title" className={inputCls} value={f.jobTitle} maxLength={80} onChange={(e) => set({ jobTitle: e.target.value })} />
              </Field>
              <Field id="st-dept" label="Departman" error={fe("department")}>
                <input id="st-dept" className={inputCls} value={f.department} maxLength={80} onChange={(e) => set({ department: e.target.value })} />
              </Field>
              <Field id="st-phone" label="Telefon" error={fe("phone")}>
                <input id="st-phone" type="tel" className={inputCls} value={f.phone} maxLength={20} onChange={(e) => set({ phone: e.target.value })} aria-invalid={!!fe("phone")} />
              </Field>
            </div>
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Roller" subtitle={self ? "Kendi rollerinizi değiştirirken dikkat: kullanıcı yönetimi yetkisini kaybedebilirsiniz." : "Yetkiler rollerden gelir; değişiklik bir sonraki istekte geçerli olur."} />
            <div className="grid gap-5 p-5 lg:grid-cols-2">
              <div>
                <RolePicker roles={roles} value={f.roleIds} onChange={(roleIds) => set({ roleIds })} />
                {fe("roleIds") ? <p className="mt-1 text-xs text-red-600">{fe("roleIds")}</p> : null}
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Sonuç yetkiler</p>
                <ul className="space-y-3">
                  {PERMISSION_GROUPS.map((g) => (
                    <li key={g.key}>
                      <p className="text-xs font-medium text-slate-600">{g.label}</p>
                      <ul className="mt-1 flex flex-wrap gap-1">
                        {g.permissions.map((p) => (
                          <li key={p.code} className={`rounded-full px-2 py-0.5 text-[11px] ${granted.has(p.code) ? "bg-emerald-100 text-emerald-800" : "bg-white text-slate-400 line-through"}`}>{p.label}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </AdminCard>

          <div className="sticky bottom-4 z-30">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
              <p className="text-sm text-slate-500">{dirty ? "Kaydedilmemiş değişiklikler var." : "Değişiklik yok."}</p>
              <div className="flex gap-2">
                <button type="button" disabled={!dirty || saving} onClick={() => setF(initial)} className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">Değişiklikleri geri al</button>
                <button type="submit" disabled={!dirty || saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60">
                  <Save className="size-4" />{saving ? "Bekleyin…" : "Güncelle"}
                </button>
              </div>
            </div>
          </div>
        </form>

        <div className="space-y-6 xl:sticky xl:top-20 xl:self-start">
          <AdminCard>
            <AdminCardTitle title="Hesap" />
            <div className="space-y-2 p-5">
              {staff.state === "invited" ? (
                <>
                  <p className="mb-2 text-xs text-slate-500">Davet {fmt(staff.inviteExpiresAt, "süresi dolmuş")}{staff.inviteExpiresAt ? " tarihine kadar geçerli" : ""}.</p>
                  <button type="button" className={btn} disabled={!!busyAction} onClick={() => ask("resend_invite")}><MailPlus className="size-4" />Yeni davet bağlantısı oluştur</button>
                  <button type="button" className={`${btn} text-red-600`} disabled={!!busyAction} onClick={() => ask("cancel_invite")}><Trash2 className="size-4" />Daveti iptal et</button>
                </>
              ) : null}
              {staff.state === "active" ? (
                <>
                  <button type="button" className={btn} disabled={!!busyAction} onClick={() => ask("password_reset")}><KeyRound className="size-4" />Parola sıfırlama bağlantısı</button>
                  <button type="button" className={btn} disabled={!!busyAction || staff.sessions.length === 0} onClick={() => ask("revoke_sessions")}><LogOut className="size-4" />Tüm oturumları kapat</button>
                </>
              ) : null}
              {staff.state === "suspended" ? (
                <button type="button" className={btn} disabled={!!busyAction} onClick={() => ask("reactivate")}><UserCheck className="size-4" />Yeniden etkinleştir</button>
              ) : (
                <button type="button" className={`${btn} text-red-600`} disabled={!!busyAction || self} title={self ? "Kendi hesabınızı askıya alamazsınız." : undefined} onClick={() => ask("suspend")}>
                  <Ban className="size-4" />Askıya al
                </button>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 p-5 text-xs">
              <div><dt className="text-slate-500">Son giriş</dt><dd className="mt-0.5 font-medium text-slate-800">{fmt(staff.lastLoginAt, "Hiç")}</dd></div>
              <div><dt className="text-slate-500">Parola değişimi</dt><dd className="mt-0.5 font-medium text-slate-800">{fmt(staff.passwordChangedAt)}</dd></div>
              <div><dt className="text-slate-500">Davet eden</dt><dd className="mt-0.5 font-medium text-slate-800">{staff.invitedByName ?? "—"}</dd></div>
              <div><dt className="text-slate-500">Hatalı giriş (son başarılıdan beri)</dt><dd className="mt-0.5 font-medium text-slate-800">{staff.failedAttempts}</dd></div>
            </dl>
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Açık oturumlar" subtitle="Panel oturumları 8 saat sürer." />
            {staff.sessions.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">Açık oturum yok.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {staff.sessions.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <RotateCcw className="size-4 flex-none text-slate-400" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-slate-700">Başlangıç {fmt(s.createdAt)}</span>
                      <span className="block text-xs text-slate-500">Bitiş {fmt(s.expiresAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>
      </div>

      {confirm && CONFIRM[confirm] ? (
        <AdminConfirmDialog open title={CONFIRM[confirm]!.title} description={CONFIRM[confirm]!.description} confirmLabel={CONFIRM[confirm]!.label}
          tone={CONFIRM[confirm]!.tone} busy={busyAction === confirm} onConfirm={() => run(confirm)} onCancel={() => setConfirm(null)} />
      ) : null}
      <OneTimeLinkDialog link={link} title={linkTitle} recipient={staff.displayName} onClose={() => setLink(null)} />
    </div>
  );
}
