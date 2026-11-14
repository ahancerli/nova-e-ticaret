"use client";

import { useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Counter, Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import type { ConsentAdminView } from "@/modules/consent";
import {
  BANNER_LAYOUTS, BANNER_LAYOUT_CODES, BANNER_TEXT_FIELDS, BANNER_TEXT_KEYS, CONSENT_PROVIDERS, CONSENT_PROVIDER_CODES, GOOGLE_CONSENT_MODES,
  GOOGLE_CONSENT_MODE_CODES, type BannerLayout, type ConsentProviderCode, type GoogleConsentMode,
} from "@/modules/consent/domain/consent";
import { consentApi } from "../api";

const primary = "inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60";
const btn = "inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";
const choiceCls = (on: boolean) => `rounded-xl border p-3 text-left text-sm transition ${on ? "border-[#7367f0] bg-indigo-50/60 ring-1 ring-[#7367f0]" : "border-slate-200 hover:border-slate-300"}`;

/** Where the banner sits, drawn as a tiny page: the choice is spatial, so the option shows the space. */
function LayoutSketch({ layout }: { layout: BannerLayout }) {
  return (
    <span className="relative mb-2 block h-14 overflow-hidden rounded-md border border-slate-200 bg-slate-50" aria-hidden>
      <span className="absolute inset-x-2 top-2 h-1.5 rounded bg-slate-200" />
      <span className="absolute left-2 top-5 h-1.5 w-2/3 rounded bg-slate-200" />
      {layout === "bar" && <span className="absolute inset-x-0 bottom-0 h-3.5 border-t border-[#7367f0]/40 bg-[#7367f0]/25" />}
      {layout === "box" && <span className="absolute bottom-1.5 left-1.5 h-6 w-9 rounded border border-[#7367f0]/40 bg-[#7367f0]/25" />}
      {layout === "modal" && <><span className="absolute inset-0 bg-slate-900/15" /><span className="absolute left-1/2 top-1/2 h-7 w-12 -translate-x-1/2 -translate-y-1/2 rounded border border-[#7367f0]/50 bg-white" /></>}
    </span>
  );
}

export function BannerSettingsCard({ view, onSaved }: { view: ConsentAdminView; onSaved: (v: ConsentAdminView) => void }) {
  const s = view.settings;
  const errors = useFieldErrors();
  const [bannerEnabled, setBannerEnabled] = useState(s.bannerEnabled);
  const [provider, setProvider] = useState<ConsentProviderCode>(s.provider);
  const [layout, setLayout] = useState<BannerLayout>(s.layout);
  const [mode, setMode] = useState<GoogleConsentMode>(s.googleConsentMode);
  const [maxAgeDays, setMaxAgeDays] = useState(String(s.maxAgeDays));
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(BANNER_TEXT_KEYS.map((k) => [k, s.texts[k] ?? ""])));
  const [saving, setSaving] = useState(false);
  const [confirmRenew, setConfirmRenew] = useState(false);
  const [renewing, setRenewing] = useState(false);

  const chooseProvider = (code: ConsentProviderCode) => {
    if (!CONSENT_PROVIDERS[code].ready) {
      const m = `${CONSENT_PROVIDERS[code].label} için entegrasyon henüz yapılmadı. Bu firmayla çalışmak için yazılım firmanıza (geliştirici ekibe) bilgi verin.`;
      notify.error(m, { fallback: m });
      return;
    }
    setProvider(code);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    errors.clear();
    try {
      const r = await consentApi.admin.save({
        bannerEnabled, provider, providerConfig: {}, layout, googleConsentMode: mode, maxAgeDays: Number(maxAgeDays) || 0,
        texts: Object.fromEntries(Object.entries(texts).filter(([, v]) => v.trim())), expectedUpdatedAt: s.updatedAt,
      });
      onSaved(r.data);
      notify.success("Çerez onayı ayarları güncellendi");
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Ayarlar güncellenemedi." });
    } finally {
      setSaving(false);
    }
  };

  const renew = async () => {
    setRenewing(true);
    try {
      const r = await consentApi.admin.renew();
      onSaved(r.data);
      notify.success("Onay yeniden istenecek", { description: "Ziyaretçiler bir sonraki sayfada banner'ı yeniden görür." });
    } catch (err) {
      notify.error(err, { fallback: "Onay yenilenemedi." });
    } finally {
      setRenewing(false);
      setConfirmRenew(false);
    }
  };

  return (
    <form onSubmit={save} className="max-w-5xl space-y-6">
      <AdminCard>
        <AdminCardTitle
          title="Durum"
          actions={bannerEnabled ? <AdminBadge tone="green">Onay soruluyor</AdminBadge> : <AdminBadge tone="amber">Kapalı — yalnız zorunlu çerezler</AdminBadge>}
        />
        <div className="space-y-4 px-5 py-4 text-sm">
          {!view.policy && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
              Çerez politikası yayında değil. İçerik › Yasal metinler bölümünden yayınlayın; banner üzerindeki bağlantı ve onay revizyonu bu sayfaya bağlıdır.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-slate-600">
              Geçerli onay revizyonu <span className="font-semibold text-slate-900">{view.revision}</span>
              {view.policy && <> · politika sürümü {view.policy.version}</>}
              <span className="block text-xs text-slate-500">Yeni bir izleme firması etkinleşince veya çerez politikası güncellenince revizyon değişir ve ziyaretçilere yeniden sorulur.</span>
            </p>
            <button type="button" className={btn} onClick={() => setConfirmRenew(true)}><RefreshCw className="h-4 w-4" />Onayı yeniden iste</button>
          </div>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#7367f0]" checked={bannerEnabled} onChange={(e) => setBannerEnabled(e.target.checked)} />
            <span>
              <span className="font-medium text-slate-900">Ziyaretçiden çerez onayı iste</span>
              <span className="block text-xs text-slate-500">Kapalıyken banner gösterilmez ve hiçbir analitik / reklam etiketi yüklenmez (onay olmadan çalıştırılamaz).</span>
            </span>
          </label>
        </div>
      </AdminCard>

      <AdminCard>
        <AdminCardTitle title="Onayı toplayan araç" subtitle="Firma kendi CMP hesabıyla çalışmak isterse adaptörü yazılınca buradan seçilir." />
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          {CONSENT_PROVIDER_CODES.map((code) => {
            const p = CONSENT_PROVIDERS[code];
            return (
              <button key={code} type="button" onClick={() => chooseProvider(code)} aria-pressed={provider === code} className={choiceCls(provider === code)}>
                <span className="flex items-center justify-between gap-2 font-medium text-slate-900">{p.label}{!p.ready && <AdminBadge>Yakında</AdminBadge>}</span>
                <span className="mt-1 block text-xs text-slate-500">{p.hint}</span>
              </button>
            );
          })}
        </div>
      </AdminCard>

      <AdminCard>
        <AdminCardTitle title="Görünüm ve davranış" />
        <div className="space-y-5 px-5 py-4">
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-slate-600">Banner yerleşimi</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {BANNER_LAYOUT_CODES.map((code) => (
                <button key={code} type="button" onClick={() => setLayout(code)} aria-pressed={layout === code} className={choiceCls(layout === code)}>
                  <LayoutSketch layout={code} />
                  <span className="font-medium text-slate-900">{BANNER_LAYOUTS[code].label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{BANNER_LAYOUTS[code].hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-slate-600">Google Consent Mode v2</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {GOOGLE_CONSENT_MODE_CODES.map((code) => (
                <button key={code} type="button" onClick={() => setMode(code)} aria-pressed={mode === code} className={choiceCls(mode === code)}>
                  <span className="font-medium text-slate-900">{GOOGLE_CONSENT_MODES[code].label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{GOOGLE_CONSENT_MODES[code].hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <Field id="maxAgeDays" label="Onayın geçerlilik süresi (gün)" error={errors.get("maxAgeDays")} hint="Bu süre dolunca tercih yeniden sorulur. 30–395 gün (önerilen 365)." className="max-w-xs">
            <input id="maxAgeDays" type="number" inputMode="numeric" min={30} max={395} className={inputCls} value={maxAgeDays}
              aria-invalid={errors.has("maxAgeDays")} onChange={(e) => setMaxAgeDays(e.target.value)} />
          </Field>
        </div>
      </AdminCard>

      <AdminCard>
        <AdminCardTitle title="Metinler" subtitle="Boş bırakılan alan varsayılan metinle gösterilir. Kabul ve ret butonları her zaman aynı görünümde ve yan yana durur." />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          {BANNER_TEXT_KEYS.map((k) => {
            const f = BANNER_TEXT_FIELDS[k];
            const long = k === "body";
            const id = `texts.${k}`;
            return (
              <Field key={k} id={id} label={f.label} error={errors.get(id)} hint={<Counter value={texts[k] ?? ""} max={f.max} />} className={long ? "sm:col-span-2" : ""}>
                {long ? (
                  <textarea id={id} rows={4} className={inputCls} placeholder={f.default} value={texts[k]} aria-invalid={errors.has(id)} onChange={(e) => setTexts((t) => ({ ...t, [k]: e.target.value }))} />
                ) : (
                  <input id={id} className={inputCls} placeholder={f.default} value={texts[k]} aria-invalid={errors.has(id)} onChange={(e) => setTexts((t) => ({ ...t, [k]: e.target.value }))} />
                )}
              </Field>
            );
          })}
        </div>
      </AdminCard>

      <div className="flex justify-end">
        <button type="submit" className={primary} disabled={saving}>{saving ? "Güncelleniyor…" : "Güncelle"}</button>
      </div>

      <AdminConfirmDialog
        open={confirmRenew} tone="primary" busy={renewing} confirmLabel="Yeniden iste" busyLabel="Yenileniyor…"
        title="Onay tüm ziyaretçilere yeniden sorulsun mu?"
        description="Kayıtlı tercihler geçersiz olur; her ziyaretçi bir sonraki sayfada banner'ı yeniden görür ve seçim yapana kadar etiketler yüklenmez."
        onConfirm={renew} onCancel={() => setConfirmRenew(false)}
      />
    </form>
  );
}
