"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, AtSign, CheckCircle2, KeyRound, Mail, Send, Server, ShieldCheck, Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import type { MailDeliveryView, MailSettingsView } from "@/modules/mail";
import { SMTP_PRESETS, type SmtpSecurity } from "@/modules/mail/domain/presets";
import { integrationsApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const SECURITY_LABEL: Record<SmtpSecurity, string> = { ssl: "SSL / TLS (genelde 465)", starttls: "STARTTLS (genelde 587)" };
const PURPOSE_LABEL: Record<MailDeliveryView["purpose"], string> = { password_reset: "Parola sıfırlama", test: "Test e-postası", other: "E-posta" };
const STAGE_LABEL: Record<string, string> = {
  connect: "bağlantı", tls: "şifreli bağlantı (TLS)", greeting: "sunucu karşılaması", ehlo: "tanışma (EHLO)", starttls: "STARTTLS",
  auth: "giriş (kullanıcı adı / parola)", sender: "gönderen adresi", recipient: "alıcı adresi", data: "e-posta içeriği",
};
const isGmail = (host: string) => /(^|\.)(gmail|googlemail|google)\.com$/i.test(host.trim());

/** Settings that are known not to work, warned before saving (the server would only fail at send time). */
function configWarnings(f: { host: string; port: string; security: SmtpSecurity; username: string; fromEmail: string }): string[] {
  const w: string[] = [];
  const port = Number(f.port);
  if (port === 465 && f.security === "starttls") w.push("465 numaralı port “SSL / TLS” ister; STARTTLS ile bağlantı zaman aşımına düşer.");
  if (port === 587 && f.security === "ssl") w.push("587 numaralı port “STARTTLS” ister; SSL ile bağlantı kurulamaz.");
  if (isGmail(f.host)) {
    if (f.username && !f.username.includes("@")) w.push("Gmail'de kullanıcı adı Gmail adresinizin tamamı olmalı (ornek@gmail.com).");
    if (f.fromEmail && f.username && f.fromEmail.trim().toLowerCase() !== f.username.trim().toLowerCase())
      w.push("Gmail, doğrulanmış takma ad değilse gönderen adresini hesap adresinizle değiştirir; gönderen e-postayı kullanıcı adıyla aynı yapın.");
  }
  return w;
}

/** "Son gönderimler": every attempt with its outcome; failed rows say why (classified) and what the server answered. */
function DeliveryList({ rows }: { rows: MailDeliveryView[] }) {
  if (!rows.length) return <p className="px-5 py-4 text-sm text-slate-500">Henüz gönderim yok. Test e-postası gönderin ya da “Parolamı unuttum”u deneyin.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={r.id} className="px-5 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {r.status === "sent" ? <AdminBadge tone="green">Gönderildi</AdminBadge>
              : r.status === "failed" ? <AdminBadge tone="red">Gönderilemedi</AdminBadge>
              : r.status === "throttled" ? <AdminBadge tone="amber">Bekletildi</AdminBadge>
              : <AdminBadge tone="slate">SMTP ayarı yok</AdminBadge>}
            <span className="font-medium text-slate-800">{PURPOSE_LABEL[r.purpose]}</span>
            <span className="text-slate-500">→ {r.recipient}</span>
            <span className="ml-auto text-xs text-slate-400">{dt.format(new Date(r.createdAt))}{r.latencyMs != null ? ` · ${(r.latencyMs / 1000).toFixed(1)} sn` : ""}</span>
          </div>
          {r.status === "sent" && (
            <p className="mt-1 text-xs text-slate-500">{r.smtpHost} e-postayı teslim aldı{r.serverReply ? <>: <span className="font-mono">{r.serverReply}</span></> : null}</p>
          )}
          {r.status === "failed" && (
            <div className="mt-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 ring-1 ring-red-100">
              <p className="font-medium">{r.errorMessage}</p>
              <p className="mt-0.5 text-red-700/80">
                {r.smtpHost}{r.stage ? ` · adım: ${STAGE_LABEL[r.stage] ?? r.stage}` : ""} · kod: <span className="font-mono">{r.errorCode}</span>
              </p>
              {r.serverReply && <p className="mt-0.5 break-all font-mono text-red-700/80">Sunucu yanıtı: {r.serverReply}</p>}
            </div>
          )}
          {r.status === "throttled" && <p className="mt-1 text-xs text-slate-500">Bu adrese 2 dakika içinde zaten bağlantı gönderildi; yeni e-posta gönderilmedi.</p>}
          {r.status === "not_configured" && <p className="mt-1 text-xs text-slate-500">SMTP ayarı olmadığı için e-posta gönderilemedi.</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * E-posta (SMTP): the shop's outgoing mail account (password reset e-mails). The password is write-only — sealed
 * on the server and never shown again; leaving it empty keeps the stored one.
 */
export function MailIntegrationManager({ initial, adminEmail, deliveries }: { initial: MailSettingsView | null; adminEmail: string; deliveries: MailDeliveryView[] }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const [form, setForm] = useState({
    host: initial?.host ?? "", port: String(initial?.port ?? 465), security: (initial?.security ?? "ssl") as SmtpSecurity,
    username: initial?.username ?? "", password: "", fromEmail: initial?.fromEmail ?? "", fromName: initial?.fromName ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const preset = SMTP_PRESETS.find((p) => p.host === form.host);
  const warnings = configWarnings(form);
  const lastFailure = deliveries[0]?.status === "failed" ? deliveries[0] : null;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.value;
    setForm((f) => ({
      ...f, [k]: v,
      // the sender usually is the account itself — follow the username until the user types another sender
      ...(k === "username" && (!f.fromEmail || f.fromEmail === f.username) ? { fromEmail: v } : {}),
    }));
    errors.clear(k);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    errors.clear();
    try {
      await integrationsApi.mail.save({ ...form, port: Number(form.port), password: form.password || undefined, expectedUpdatedAt: initial?.updatedAt ?? null });
      notify.success(initial ? "E-posta ayarları güncellendi" : "E-posta ayarları eklendi", { description: "Bağlantıyı denemek için test e-postası gönderin." });
      router.refresh();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "E-posta ayarları kaydedilemedi." });
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await integrationsApi.mail.test();
      notify.success("Test e-postası gönderildi", { description: `${r.data.host} teslim aldı → ${r.data.to} · ${(r.data.latencyMs / 1000).toFixed(1)} sn. Gelen kutunuzu (ve spam klasörünü) kontrol edin.` });
    } catch (err) {
      notify.error(err, { fallback: "Test e-postası gönderilemedi." });
    } finally {
      setTesting(false);
      router.refresh(); // the attempt is in "Son gönderimler" either way
    }
  };

  const remove = async () => {
    if (!initial) return;
    setRemoving(true);
    try {
      await integrationsApi.mail.remove(initial.updatedAt);
      notify.success("E-posta ayarları kaldırıldı");
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "E-posta ayarları kaldırılamadı." });
      setRemoving(false);
      setConfirmRemove(false);
    }
  };

  const icon = (I: typeof Mail) => <I className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />;

  return (
    <div className="space-y-6">
      <AdminPageHeader title="E-posta (SMTP)"
        subtitle="Mağazanın e-posta hesabı. “Parolamı unuttum” sıfırlama bağlantıları bu hesaptan gönderilir." />

      <AdminCard className="max-w-4xl">
        <AdminCardTitle title="Mevcut durum" actions={initial ? <AdminBadge tone="green">Bağlı</AdminBadge> : <AdminBadge tone="slate">Bağlı değil</AdminBadge>} />
        {initial ? (
          <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid size-11 flex-none place-items-center rounded-xl bg-indigo-50 text-[#7367f0]"><Mail className="h-5 w-5" /></span>
              <div className="text-sm">
                <p className="font-semibold text-slate-900">{initial.fromName} <span className="font-normal text-slate-500">&lt;{initial.fromEmail}&gt;</span></p>
                <p className="text-xs text-slate-500">
                  {initial.host}:{initial.port} · {initial.security === "ssl" ? "SSL" : "STARTTLS"} · parola kayıtlı · son güncelleme {dt.format(new Date(initial.updatedAt))}{initial.updatedBy ? ` · ${initial.updatedBy}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={test} disabled={testing}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                <Send className="h-4 w-4" /> {testing ? "Gönderiliyor…" : "Test e-postası gönder"}
              </button>
              <button type="button" onClick={() => setConfirmRemove(true)} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50">
                <Trash2 className="h-4 w-4" /> Kaldır
              </button>
            </div>
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-slate-600">E-posta hesabı bağlanmadı; “Parolamı unuttum” e-postaları gönderilemez. Aşağıdan SMTP bilgilerini girin.</p>
        )}
        {initial && <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500">Test e-postası sizin adresinize gider: <b className="font-medium text-slate-700">{adminEmail}</b></p>}
        {lastFailure && (
          <p className="flex items-start gap-2 border-t border-red-100 bg-red-50 px-5 py-2.5 text-xs text-red-800">
            <AlertTriangle className="mt-px h-3.5 w-3.5 flex-none" /> Son gönderim başarısız ({dt.format(new Date(lastFailure.createdAt))}): {lastFailure.errorMessage}
          </p>
        )}
      </AdminCard>

      <AdminCard className="max-w-4xl">
        <AdminCardTitle title="SMTP bilgileri" subtitle="E-posta sağlayıcınızın giden posta (SMTP) ayarları." />
        <form onSubmit={save} className="space-y-5 px-5 py-5" noValidate>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Hazır ayar</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Hazır SMTP ayarları">
              {SMTP_PRESETS.map((p) => {
                const on = preset?.key === p.key;
                return (
                  <button key={p.key} type="button" aria-pressed={on}
                    onClick={() => { setForm((f) => ({ ...f, host: p.host, port: String(p.port), security: p.security })); errors.clear(); }}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${on ? "border-[#7367f0] bg-indigo-50 text-[#5b4fe0] ring-2 ring-[#7367f0]/15" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                    {on && <CheckCircle2 className="h-4 w-4" />}{p.label}
                  </button>
                );
              })}
            </div>
            {preset && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">{preset.note}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1.4fr)]">
            <Field id="smtp-host" label="SMTP sunucusu" required error={errors.get("host")}>
              <div className="relative">{icon(Server)}
                <input id="smtp-host" className={`${inputCls} h-10 pl-9 font-mono`} value={form.host} placeholder="smtp.gmail.com" onChange={set("host")} aria-invalid={errors.has("host")} autoComplete="off" />
              </div>
            </Field>
            <Field id="smtp-port" label="Port" required error={errors.get("port")}>
              <input id="smtp-port" inputMode="numeric" className={`${inputCls} h-10 font-mono`} value={form.port} onChange={set("port")} aria-invalid={errors.has("port")} />
            </Field>
            <Field id="smtp-security" label="Güvenlik" required error={errors.get("security")}>
              <div className="relative">{icon(ShieldCheck)}
                <select id="smtp-security" className={`${inputCls} h-10 pl-9`} value={form.security} onChange={set("security")}>
                  {(Object.keys(SECURITY_LABEL) as SmtpSecurity[]).map((k) => <option key={k} value={k}>{SECURITY_LABEL[k]}</option>)}
                </select>
              </div>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="smtp-user" label="Kullanıcı adı" required error={errors.get("username")} hint="Genelde e-posta adresinizin tamamı.">
              <div className="relative">{icon(AtSign)}
                <input id="smtp-user" className={`${inputCls} h-10 pl-9`} value={form.username} placeholder="ornek@gmail.com" onChange={set("username")} aria-invalid={errors.has("username")} autoComplete="off" spellCheck={false} />
              </div>
            </Field>
            <Field id="smtp-pass" label="Parola" required={!initial} error={errors.get("password")}
              hint={initial ? "Parola kayıtlı ve gösterilmez. Değiştirmeyecekseniz boş bırakın." : "Şifrelenerek saklanır ve bir daha gösterilmez."}>
              <div className="relative">{icon(KeyRound)}
                <input id="smtp-pass" type="password" autoComplete="new-password" spellCheck={false} className={`${inputCls} h-10 pl-9`} value={form.password}
                  placeholder={initial ? "••••••••••••" : "Uygulama şifresi"} onChange={set("password")} aria-invalid={errors.has("password")} />
              </div>
            </Field>
            <Field id="smtp-from" label="Gönderen e-posta" required error={errors.get("fromEmail")} hint="Gmail'de kullanıcı adınızla aynı olmalı.">
              <div className="relative">{icon(Mail)}
                <input id="smtp-from" type="email" className={`${inputCls} h-10 pl-9`} value={form.fromEmail} onChange={set("fromEmail")} aria-invalid={errors.has("fromEmail")} />
              </div>
            </Field>
            <Field id="smtp-name" label="Gönderen adı" required error={errors.get("fromName")} hint="Alıcının gelen kutusunda görünen ad.">
              <input id="smtp-name" className={`${inputCls} h-10`} value={form.fromName} placeholder="Mağaza adınız" maxLength={100} onChange={set("fromName")} aria-invalid={errors.has("fromName")} />
            </Field>
          </div>

          {warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">
              {warnings.map((w) => <li key={w} className="flex items-start gap-1.5"><AlertTriangle className="mt-px h-3.5 w-3.5 flex-none" />{w}</li>)}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
            <button type="submit" disabled={saving}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60">
              <Mail className="h-4 w-4" />
              {saving ? (initial ? "Güncelleniyor…" : "Ekleniyor…") : initial ? "Güncelle" : "E-posta hesabını ekle"}
            </button>
          </div>
        </form>
      </AdminCard>

      <AdminCard className="max-w-4xl">
        <AdminCardTitle title="Son gönderimler" subtitle="Her e-posta denemesi ve sonucu (son 30 gün). “Gönderildi” = SMTP sunucusu e-postayı teslim aldı." />
        <DeliveryList rows={deliveries} />
      </AdminCard>

      <AdminConfirmDialog open={confirmRemove} title="E-posta ayarları kaldırılsın mı?"
        description="SMTP bilgileri ve parola silinecek. “Parolamı unuttum” e-postaları yeni ayar girilene kadar gönderilemez."
        confirmLabel="Evet, kaldır" busyLabel="Kaldırılıyor…" busy={removing} onConfirm={remove} onCancel={() => setConfirmRemove(false)} />
    </div>
  );
}
