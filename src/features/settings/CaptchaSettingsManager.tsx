"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import { useCaptchaWidget } from "@/features/captcha/useCaptcha";
import {
  CAPTCHA_FORMS, CAPTCHA_FORM_KEYS, CAPTCHA_HEADER, CAPTCHA_PROVIDERS, CAPTCHA_PROVIDER_KEYS, CAPTCHA_VERIFY_ACTION, DEFAULT_MIN_SCORE, TURNSTILE_TEST_KEYS,
  type CaptchaForm, type CaptchaProvider, type CaptchaSettingsView,
} from "@/modules/captcha/domain/captcha";
import { settingsApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const SCORES = [
  { value: 0.3, label: "0.3 — esnek (daha az yanlış engel)" },
  { value: 0.5, label: "0.5 — önerilen" },
  { value: 0.7, label: "0.7 — sıkı (yoğun saldırı altında)" },
];
const looksLikeKey = (v: string) => /^[A-Za-z0-9_-]{20,100}$/.test(v.trim());

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className="relative h-6 w-11 flex-none rounded-full bg-slate-200 transition peer-checked:bg-[#7367f0] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#7367f0] after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
      {label}
    </label>
  );
}

/**
 * Ayarlar › Bot koruması. Keys come from the provider's own panel; the secret key is write-only. Turning protection on
 * (or changing keys while on) needs one solved widget with exactly these keys — the server verifies that token, so a
 * wrong site key can never go live and lock customers out of login.
 */
export function CaptchaSettingsManager({ initial }: { initial: CaptchaSettingsView | null }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const [form, setForm] = useState({
    enabled: initial?.enabled ?? false,
    provider: (initial?.provider ?? "turnstile") as CaptchaProvider,
    siteKey: initial?.siteKey ?? "",
    secretKey: "",
    forms: initial?.forms ?? (CAPTCHA_FORM_KEYS as CaptchaForm[]),
    minScore: initial?.minScore ?? DEFAULT_MIN_SCORE,
  });
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); errors.clear(); };

  const keysChanged = !initial || initial.provider !== form.provider || initial.siteKey !== form.siteKey.trim() || !!form.secretKey.trim();
  const needsCheck = form.enabled && (keysChanged || !initial?.enabled || !initial?.verifiedAt);
  const canShowWidget = needsCheck && looksLikeKey(form.siteKey);
  const verify = useCaptchaWidget(canShowWidget ? form.provider : null, form.siteKey.trim(), CAPTCHA_VERIFY_ACTION, "always");
  const provider = CAPTCHA_PROVIDERS[form.provider];
  const submitLabel = initial ? "Güncelle" : "Bot korumasını ekle";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    errors.clear();
    try {
      const verificationToken = canShowWidget ? (await verify.headers())[CAPTCHA_HEADER] : undefined;
      await settingsApi.captcha.save({
        ...form, siteKey: form.siteKey.trim(), secretKey: form.secretKey.trim() || undefined, verificationToken, expectedUpdatedAt: initial?.updatedAt ?? null,
      });
      notify.success(form.enabled ? "Bot koruması açık" : "Bot koruması ayarları güncellendi", {
        description: form.enabled ? `${form.forms.map((f) => CAPTCHA_FORMS[f].label).join(", ")} formlarında doğrulama isteniyor.` : "Formlarda doğrulama istenmiyor.",
      });
      router.refresh();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Bot koruması ayarları kaydedilemedi." });
      verify.reset();
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link href="/admin/ayarlar" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#7367f0]"><ArrowLeft className="size-4" />Site ayarları</Link>
      <AdminPageHeader title="Bot koruması"
        subtitle="Üye ol, giriş, şifremi unuttum ve ürün değerlendirme formlarında robot doğrulaması (CAPTCHA). IP başına deneme sınırı her durumda çalışır." />

      <form onSubmit={save} noValidate className="max-w-4xl space-y-6">
        <AdminCard>
          <AdminCardTitle title="Durum" actions={initial?.enabled ? <AdminBadge tone="green">Açık</AdminBadge> : <AdminBadge tone="slate">Kapalı</AdminBadge>} />
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className={`grid size-11 flex-none place-items-center rounded-xl ${form.enabled ? "bg-indigo-50 text-[#7367f0]" : "bg-slate-100 text-slate-400"}`}>
                {form.enabled ? <ShieldCheck className="size-5" /> : <ShieldOff className="size-5" />}
              </span>
              <div className="text-sm">
                <p className="font-semibold text-slate-900">{form.enabled ? "Seçili formlarda doğrulama istenir" : "Formlarda doğrulama istenmiyor"}</p>
                <p className="text-xs text-slate-500">
                  {initial ? `${CAPTCHA_PROVIDERS[initial.provider].label} · gizli anahtar …${initial.secretHint}${initial.verifiedAt ? ` · son doğrulama ${dt.format(new Date(initial.verifiedAt))}` : " · henüz doğrulanmadı"}${initial.updatedBy ? ` · ${initial.updatedBy}` : ""}` : "Sağlayıcı anahtarları henüz girilmedi."}
                </p>
              </div>
            </div>
            <Switch checked={form.enabled} onChange={(enabled) => set({ enabled })} label="Korumayı aç" />
          </div>
        </AdminCard>

        <AdminCard>
          <AdminCardTitle title="Sağlayıcı ve anahtarlar" subtitle="Anahtarları sağlayıcının panelinde mağazanızın alan adı için oluşturun." />
          <div className="space-y-5 px-5 py-5">
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Sağlayıcı">
              {CAPTCHA_PROVIDER_KEYS.map((k) => {
                const on = form.provider === k;
                return (
                  <button key={k} type="button" role="radio" aria-checked={on} onClick={() => set({ provider: k })}
                    className={`rounded-xl border p-4 text-left transition ${on ? "border-[#7367f0] bg-indigo-50/60 ring-2 ring-[#7367f0]/15" : "border-slate-200 hover:bg-slate-50"}`}>
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">{on && <CheckCircle2 className="size-4 text-[#7367f0]" />}{CAPTCHA_PROVIDERS[k].label}</span>
                    <span className="mt-1 block text-xs text-slate-600">{CAPTCHA_PROVIDERS[k].note}</span>
                  </button>
                );
              })}
            </div>
            <a href={provider.keysUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#7367f0] hover:underline">
              <ExternalLink className="size-4" />{provider.label} anahtarlarını oluştur
            </a>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="captcha-site" label="Site anahtarı (site key)" required error={errors.get("siteKey")} hint="Herkese açıktır; sayfaya eklenir.">
                <input id="captcha-site" className={`${inputCls} h-10 font-mono`} value={form.siteKey} spellCheck={false} autoComplete="off"
                  onChange={(e) => set({ siteKey: e.target.value })} aria-invalid={errors.has("siteKey")} />
              </Field>
              <Field id="captcha-secret" label="Gizli anahtar (secret key)" required={!initial || initial.provider !== form.provider} error={errors.get("secretKey")}
                hint={initial && initial.provider === form.provider ? `Kayıtlı (…${initial.secretHint}) ve gösterilmez. Değiştirmeyecekseniz boş bırakın.` : "Şifrelenerek saklanır ve bir daha gösterilmez."}>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input id="captcha-secret" type="password" autoComplete="new-password" spellCheck={false} className={`${inputCls} h-10 pl-9 font-mono`}
                    value={form.secretKey} placeholder={initial ? "••••••••••••" : ""} onChange={(e) => set({ secretKey: e.target.value })} aria-invalid={errors.has("secretKey")} />
                </div>
              </Field>
            </div>
            {form.provider === "turnstile" && (
              <p className="text-xs text-slate-500">
                Yerelde denemek için Cloudflare test anahtarları her zaman geçer:{" "}
                <button type="button" className="font-medium text-[#7367f0] hover:underline" onClick={() => set(TURNSTILE_TEST_KEYS)}>test anahtarlarını doldur</button>. Canlı mağazada kullanmayın.
              </p>
            )}
            {provider.scored && (
              <Field id="captcha-score" label="En düşük insan skoru" error={errors.get("minScore")} hint="Google her isteğe 0.0 (bot) – 1.0 (insan) arası skor verir; altındaki istekler reddedilir." className="max-w-sm">
                <select id="captcha-score" className={`${inputCls} h-10`} value={form.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })}>
                  {SCORES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
            )}
          </div>
        </AdminCard>

        <AdminCard>
          <AdminCardTitle title="Korunan formlar" subtitle="Seçili formlar gönderilmeden önce doğrulama istenir." />
          <fieldset className="grid gap-2 px-5 py-4 sm:grid-cols-2">
            <legend className="sr-only">Korunan formlar</legend>
            {CAPTCHA_FORM_KEYS.map((k) => (
              <label key={k} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:bg-slate-50">
                <input type="checkbox" className="mt-0.5 size-4 accent-[#7367f0]" checked={form.forms.includes(k)}
                  onChange={(e) => set({ forms: e.target.checked ? [...form.forms, k] : form.forms.filter((f) => f !== k) })} />
                <span className="text-sm"><span className="font-medium text-slate-800">{CAPTCHA_FORMS[k].label}</span><span className="block text-xs text-slate-500">{CAPTCHA_FORMS[k].where}</span></span>
              </label>
            ))}
            {errors.get("forms") ? <p className="text-xs text-red-600 sm:col-span-2">{errors.get("forms")}</p> : null}
          </fieldset>
        </AdminCard>

        {needsCheck && (
          <AdminCard>
            <AdminCardTitle title="Anahtarları doğrula" subtitle="Koruma ancak bu anahtarlarla bir doğrulama geçince açılır. Böylece yanlış bir anahtar müşterilerin girişini engelleyemez." />
            <div className="space-y-3 px-5 py-4 text-sm text-slate-600">
              {!looksLikeKey(form.siteKey) ? <p>Önce site anahtarını girin.</p>
                : form.provider === "turnstile" ? <><p>Kutu tamamlanınca “{submitLabel}” düğmesine basın.</p>{verify.slot}</>
                : <p>reCAPTCHA v3 görünmezdir; “{submitLabel}” düğmesine bastığınızda doğrulama arka planda yapılır.</p>}
              {verify.error ? <p className="text-xs text-red-600">{verify.error} Site anahtarını ve sağlayıcı panelindeki alan adlarını kontrol edin.</p> : null}
              {errors.get("verificationToken") ? <p className="text-xs text-red-600">{errors.get("verificationToken")}</p> : null}
            </div>
          </AdminCard>
        )}

        <div className="flex justify-end">
          <button type="submit" disabled={saving}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60">
            <ShieldCheck className="size-4" />{saving ? (initial ? "Güncelleniyor…" : "Ekleniyor…") : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
