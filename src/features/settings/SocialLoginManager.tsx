"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Copy, ExternalLink, KeyRound } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import { GoogleMark } from "@/features/auth/SocialButtons";
import { SOCIAL_PROVIDERS, type SocialProvider, type SocialProviderView } from "@/modules/social-login/domain/social";
import { settingsApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const MARKS: Record<SocialProvider, (p: { className?: string }) => React.ReactNode> = { google: GoogleMark };
/** Providers accept plain http only for localhost; anything else must be https. */
const insecure = (uri: string) => uri.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(uri);

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className="relative h-6 w-11 flex-none rounded-full bg-slate-200 transition peer-checked:bg-[#7367f0] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#7367f0] after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
      {label}
    </label>
  );
}

function CopyField({ id, value }: { id: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify.error("Adres kopyalanamadı. Alanı seçip elle kopyalayın.");
    }
  };
  return (
    <div className="flex gap-2">
      <input id={id} readOnly value={value} spellCheck={false} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} h-10 min-w-0 flex-1 bg-slate-50 font-mono text-[13px]`} />
      <button type="button" onClick={copy} className="inline-flex h-10 flex-none items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
        {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}{copied ? "Kopyalandı" : "Kopyala"}
      </button>
    </div>
  );
}

/**
 * One provider: switch, setup steps with this shop's callback address, and the OAuth client. The client secret is
 * write-only; the server asks the provider whether it knows the pair before anything is stored.
 */
function ProviderForm({ view }: { view: SocialProviderView }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const meta = SOCIAL_PROVIDERS[view.provider];
  const Mark = MARKS[view.provider];
  const [form, setForm] = useState({ enabled: view.enabled, clientId: view.clientId, clientSecret: "" });
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); errors.clear(); };
  const submitLabel = view.configured ? "Güncelle" : `${meta.label} ile girişi ekle`;
  const ids = { client: `social-${view.provider}-client`, secret: `social-${view.provider}-secret`, uri: `social-${view.provider}-uri` };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    errors.clear();
    try {
      await settingsApi.social.save(view.provider, {
        enabled: form.enabled, clientId: form.clientId.trim(), clientSecret: form.clientSecret.trim() || undefined, expectedUpdatedAt: view.updatedAt,
      });
      notify.success(form.enabled ? `${meta.label} ile giriş açık` : `${meta.label} ile giriş ayarları güncellendi`, {
        description: form.enabled ? "Giriş, üye ol ve ödeme adımında düğme görünüyor." : "Mağazada düğme gösterilmiyor.",
      });
      router.refresh();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Sosyal giriş ayarları kaydedilemedi." });
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="max-w-4xl space-y-6">
      <AdminCard>
        <AdminCardTitle title={`${meta.label} ile giriş`} actions={view.enabled ? <AdminBadge tone="green">Açık</AdminBadge> : <AdminBadge tone="slate">Kapalı</AdminBadge>} />
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-11 flex-none place-items-center rounded-xl border border-slate-200 bg-white"><Mark className="size-5" /></span>
            <div className="text-sm">
              <p className="font-semibold text-slate-900">{form.enabled ? `Müşteriler ${meta.label} hesabıyla giriş yapabilir ve üye olabilir` : "Mağazada düğme gösterilmiyor"}</p>
              <p className="text-xs text-slate-500">
                {view.configured
                  ? [`Client secret …${view.secretHint}`, view.verifiedAt ? `son doğrulama ${dt.format(new Date(view.verifiedAt))}` : "henüz doğrulanmadı", view.updatedBy].filter(Boolean).join(", ")
                  : "Henüz istemci bilgileri girilmedi."}
              </p>
            </div>
          </div>
          <Switch checked={form.enabled} onChange={(enabled) => set({ enabled })} label="Girişi aç" />
        </div>
      </AdminCard>

      <AdminCard>
        <AdminCardTitle title={`${meta.label} tarafında yapılacaklar`} subtitle="Bir kez yapılır, ücretsizdir."
          actions={<a href={meta.consoleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#7367f0] hover:underline"><ExternalLink className="size-4" />Cloud Console’u aç</a>} />
        <div className="space-y-5 px-5 py-5">
          <ol className="space-y-2.5 text-sm text-slate-700">
            {meta.setup.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="grid size-6 flex-none place-items-center rounded-full bg-indigo-50 text-xs font-semibold tabular-nums text-[#7367f0]">{i + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <Field id={ids.uri} label="Yetkilendirilmiş yönlendirme URI’si" hint="Harfi harfine aynı olmalı; sondaki eğik çizgi veya http / https farkı girişi bozar.">
            <CopyField id={ids.uri} value={view.redirectUri} />
          </Field>
          {insecure(view.redirectUri) && (
            <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 flex-none" />
              <span>Bu adres https ile başlamıyor; {meta.label} yalnız https adresleri kabul eder. Sunucudaki PUBLIC_SITE_URL değerini mağazanızın https adresiyle güncelleyin.</span>
            </p>
          )}
        </div>
      </AdminCard>

      <AdminCard>
        <AdminCardTitle title="İstemci bilgileri" subtitle="Kaydederken sağlayıcıya sorulur; tanınmayan bir çift kaydedilmez." />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <Field id={ids.client} label={meta.clientIdLabel} required error={errors.get("clientId")} hint={`Örnek: ${meta.clientIdExample}`}>
            <input id={ids.client} className={`${inputCls} h-10 font-mono text-[13px]`} value={form.clientId} spellCheck={false} autoComplete="off"
              onChange={(e) => set({ clientId: e.target.value })} aria-invalid={errors.has("clientId")} />
          </Field>
          <Field id={ids.secret} label="Client secret" required={!view.configured} error={errors.get("clientSecret")}
            hint={view.configured ? `Kayıtlı (…${view.secretHint}) ve gösterilmez. Değiştirmeyecekseniz boş bırakın.` : "Şifrelenerek saklanır ve bir daha gösterilmez."}>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input id={ids.secret} type="password" autoComplete="new-password" spellCheck={false} className={`${inputCls} h-10 pl-9 font-mono text-[13px]`}
                value={form.clientSecret} placeholder={view.configured ? "••••••••••••" : ""} onChange={(e) => set({ clientSecret: e.target.value })} aria-invalid={errors.has("clientSecret")} />
            </div>
          </Field>
        </div>
      </AdminCard>

      <div className="flex justify-end">
        <button type="submit" disabled={saving}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60">
          {saving ? "Sağlayıcıya soruluyor…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** Ayarlar › Sosyal giriş: one form per provider of the catalogue (`SOCIAL_PROVIDERS`). */
export function SocialLoginManager({ providers }: { providers: SocialProviderView[] }) {
  return (
    <div className="space-y-6">
      <Link href="/admin/ayarlar" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#7367f0]"><ArrowLeft className="size-4" />Site ayarları</Link>
      <AdminPageHeader title="Sosyal giriş"
        subtitle="Müşteriler parola belirlemeden, tek dokunuşla üye olur ve giriş yapar. Yalnız mağaza hesapları içindir; panel girişi parola ile kalır." />
      {providers.map((p) => <ProviderForm key={`${p.provider}:${p.updatedAt ?? "new"}`} view={p} />)}
    </div>
  );
}
