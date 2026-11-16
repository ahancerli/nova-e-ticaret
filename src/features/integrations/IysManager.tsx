"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import type { IysEnvironment, IysOverview, IysQueueState } from "@/modules/iys";
import { IYS_CHANNEL_LABEL, IYS_ENVIRONMENTS, IYS_STATE_LABEL, maskRecipient } from "@/modules/iys/domain/iys";
import { integrationsApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const btn = "inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";
const primary = "inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60";
const TONE: Record<IysQueueState, "amber" | "green" | "red" | "slate"> = { pending: "amber", sent: "green", failed: "red", skipped: "slate" };

/**
 * Entegrasyonlar › İYS: the İleti Yönetim Sistemi connection. Every commercial e-mail / SMS consent (sign-up,
 * e-bülten) and its withdrawal is queued and sent by cron; changes recipients make at İYS come back here.
 */
export function IysManager({ initial }: { initial: IysOverview }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const s = initial.settings;
  const [form, setForm] = useState({ isActive: s.isActive, environment: s.environment, iysCode: s.iysCode ?? "", brandCode: s.brandCode ?? "", username: s.username ?? "", password: "" });
  const [busy, setBusy] = useState<"save" | "test" | "retry" | "backfill" | null>(null);
  const [confirmBackfill, setConfirmBackfill] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setForm((f) => ({ ...f, [k]: e.target.value })); errors.clear(k); };

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<string>) => {
    setBusy(kind);
    try {
      notify.success(await fn());
      router.refresh();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "İşlem tamamlanamadı." });
    } finally {
      setBusy(null);
      setConfirmBackfill(false);
    }
  };
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void run("save", async () => {
      await integrationsApi.iys.save({ ...form, password: form.password || null, expectedUpdatedAt: s.updatedAt });
      return form.isActive ? "İYS bağlantısı güncellendi; izinler gönderilmeye başlar" : "İYS ayarları güncellendi (gönderim kapalı)";
    });
  };

  const c = initial.counts;
  return (
    <div className="space-y-6">
      <AdminPageHeader title="İYS (İleti Yönetim Sistemi)"
        subtitle="Ticari e-posta / SMS izinleri ve geri çekmeleri İYS'ye kaydedilir; izni İYS'de olmayan kişiye kampanya gönderilemez. Kişilerin İYS'de yaptığı değişiklikler buraya geri alınır." />

      {initial.overdue > 0 && (
        <div role="alert" className="flex gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
          <span>{initial.overdue} izin 3 iş günü içinde İYS&apos;ye kaydedilemedi. Bağlantıyı açın / hatayı düzeltin; bu kişilere kayıt tamamlanana kadar ticari ileti göndermeyin.</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        {(Object.keys(IYS_STATE_LABEL) as IysQueueState[]).map((k) => (
          <AdminCard key={k} className="p-5">
            <p className="text-xs font-medium text-slate-500">{IYS_STATE_LABEL[k]}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{c[k]}</p>
          </AdminCard>
        ))}
      </div>

      <AdminCard className="max-w-4xl">
        <AdminCardTitle title="Bağlantı"
          subtitle={s.isActive ? `Açık · ${IYS_ENVIRONMENTS[s.environment]}${s.lastPushAt ? ` · son gönderim ${dt.format(new Date(s.lastPushAt))}` : ""}${s.lastPullAt ? ` · son çekme ${dt.format(new Date(s.lastPullAt))}` : ""}` : "Kapalı: izinler kuyrukta bekler, İYS'ye gitmez."}
          actions={s.passwordSet ? <button type="button" className={btn} disabled={!!busy} onClick={() => void run("test", async () => { await integrationsApi.iys.test(); return "İYS'ye giriş yapıldı"; })}><ShieldCheck className="h-4 w-4" /> {busy === "test" ? "Deneniyor…" : "Bağlantıyı test et"}</button> : null} />
        {s.lastError ? <p className="mx-5 mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">Son hata: {s.lastError}</p> : null}
        <form onSubmit={save} noValidate className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <Field id="iys-env" label="Ortam" error={errors.get("environment")}>
            <select id="iys-env" className={`${inputCls} h-10`} value={form.environment} onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value as IysEnvironment }))}>
              {(Object.entries(IYS_ENVIRONMENTS) as [IysEnvironment, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field id="iys-code" label="İYS numarası" required error={errors.get("iysCode")} hint="İYS hizmet sağlayıcı numaranız.">
            <input id="iys-code" inputMode="numeric" className={`${inputCls} h-10`} value={form.iysCode} onChange={set("iysCode")} aria-invalid={errors.has("iysCode")} />
          </Field>
          <Field id="iys-brand" label="Marka kodu" required error={errors.get("brandCode")}>
            <input id="iys-brand" inputMode="numeric" className={`${inputCls} h-10`} value={form.brandCode} onChange={set("brandCode")} aria-invalid={errors.has("brandCode")} />
          </Field>
          <Field id="iys-user" label="API kullanıcı adı" required error={errors.get("username")}>
            <input id="iys-user" autoComplete="off" className={`${inputCls} h-10`} value={form.username} onChange={set("username")} aria-invalid={errors.has("username")} />
          </Field>
          <Field id="iys-pass" label="API şifresi" required={!s.passwordSet} error={errors.get("password")} hint={s.passwordSet ? "Kayıtlı; değiştirmek için yazın." : "Şifreli saklanır, bir daha gösterilmez."}>
            <input id="iys-pass" type="password" autoComplete="new-password" className={`${inputCls} h-10`} value={form.password} onChange={set("password")} aria-invalid={errors.has("password")} />
          </Field>
          <label className="flex items-start gap-2 self-end text-sm text-slate-700 sm:col-span-2">
            <input type="checkbox" className="mt-0.5 size-4 accent-[#7367f0]" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            <span>İzinleri İYS&apos;ye gönder <span className="block text-xs text-slate-500">Açarken İYS&apos;ye giriş denenir. Gönderim ve değişiklik çekme <code className="rounded bg-slate-100 px-1">/api/cron/iys</code> ile 5 dakikada bir çalışır.</span></span>
          </label>
          <div className="flex justify-end sm:col-span-2">
            <button type="submit" disabled={!!busy} className={primary}><CheckCircle2 className="h-4 w-4" /> {busy === "save" ? "Güncelleniyor…" : "Güncelle"}</button>
          </div>
        </form>
      </AdminCard>

      <AdminCard className="max-w-4xl">
        <AdminCardTitle title="İzin kuyruğu" subtitle="Reddedilenler önce, sonra bekleyenler ve son gönderilenler."
          actions={
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={btn} disabled={!!busy || !s.isActive} onClick={() => setConfirmBackfill(true)}><Upload className="h-4 w-4" /> Mevcut izinleri gönder</button>
              {c.failed > 0 && <button type="button" className={btn} disabled={!!busy} onClick={() => void run("retry", async () => `${(await integrationsApi.iys.retry()).data.requeued} kayıt tekrar kuyruğa alındı`)}><RefreshCw className="h-4 w-4" /> Reddedilenleri tekrar dene</button>}
            </div>
          } />
        {initial.recent.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-500">Henüz izin kaydı yok.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <tr><th className="px-5 py-3">Kanal</th><th className="px-3 py-3">Alıcı</th><th className="px-3 py-3">İzin</th><th className="px-3 py-3">Tarih</th><th className="px-5 py-3">Durum</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {initial.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-3 text-slate-700">{IYS_CHANNEL_LABEL[r.channel]}</td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-600">{maskRecipient(r.recipient)}</td>
                    <td className="px-3 py-3"><AdminBadge tone={r.status === "ONAY" ? "green" : "slate"}>{r.status === "ONAY" ? "Onay" : "Ret"}</AdminBadge></td>
                    <td className="px-3 py-3 text-xs text-slate-500">{dt.format(new Date(r.consentAt))}</td>
                    <td className="px-5 py-3"><AdminBadge tone={TONE[r.state]}>{IYS_STATE_LABEL[r.state]}</AdminBadge>{r.error ? <p className="mt-1 max-w-sm text-xs text-red-600">{r.error}</p> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      <AdminConfirmDialog open={confirmBackfill} title="Mevcut izinler İYS'ye gönderilsin mi?"
        description="Şimdiye kadar alınmış ve İYS'ye hiç gönderilmemiş tüm ticari ileti izinleri (üyelik, e-bülten) kuyruğa alınır. 3 iş gününden eski izinleri İYS reddedebilir; reddedilenler listede görünür."
        confirmLabel="Kuyruğa al" busyLabel="Alınıyor…" busy={busy === "backfill"}
        onConfirm={() => void run("backfill", async () => `${(await integrationsApi.iys.backfill()).data.queued} izin kuyruğa alındı`)} onCancel={() => setConfirmBackfill(false)} />
    </div>
  );
}
