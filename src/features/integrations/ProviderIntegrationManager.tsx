"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, KeyRound, MessageSquareText, PlugZap, Send, ShieldCheck, Trash2, Truck } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import type { IntegrationPageView, ProviderView, SmsEvent, SmsEventSetting } from "@/modules/integrations";
import {
  SMS_EVENTS, SMS_EVENT_INFO, SMS_TEMPLATE_MAX, SMS_VARIABLES, defaultSmsEvents, renderTemplate, smsParts,
} from "@/modules/integrations/domain/providers";
import { integrationsApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const btn = "inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";
const primary = "inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-5 text-sm font-semibold text-white shadow-sm shadow-[#7367f0]/30 hover:bg-[#6559df] disabled:opacity-60";

const COPY = {
  sms: {
    title: "SMS entegrasyonları", icon: MessageSquareText,
    subtitle: "Sipariş ve kargo bildirimlerini müşteriye SMS ile gönderen firma. Aynı anda tek SMS firması bağlı olur.",
  },
  shipping: {
    title: "Kargo entegrasyonları", icon: Truck,
    subtitle: "“Kargoya ver” ile gönderiyi kargo firmasına kaydeder, takip numarasını ve teslim durumunu otomatik alır.",
  },
} as const;

/** Sample values for the SMS preview. */
const SAMPLE = {
  magaza: "Mağazanız", siparis_no: "NV2611AB12", tutar: "1.249,90 ₺", kargo_firmasi: "Yurtiçi Kargo", takip_no: "123456789012",
  takip_url: "https://kargo.example/123456789012", takip_bilgisi: " Takip no: 123456789012",
};

const notIntegratedMessage = (p: ProviderView) =>
  `${p.name} için entegrasyon henüz yapılmadı. Bu firmayla çalışmak için yazılım firmanıza (geliştirici ekibe) bilgi verin.`;

/**
 * Entegrasyonlar › SMS / Kargo: firm catalog (integration_providers). A firm with an adapter shows its API fields
 * (from the catalog's field definitions); a firm without one is refused with "yazılım firmanıza bilgi verin".
 * Secret fields are write-only — sealed on the server, never shown again; empty keeps the stored value.
 */
export function ProviderIntegrationManager({ initial }: { initial: IntegrationPageView }) {
  const router = useRouter();
  const errors = useFieldErrors();
  const { kind, providers, current } = initial;
  const copy = COPY[kind];
  const currentProvider = providers.find((p) => p.code === current?.providerCode) ?? null;
  const [selected, setSelected] = useState<string>(current?.providerCode ?? providers.find((p) => p.status === "ready")?.code ?? "");
  const provider = providers.find((p) => p.code === selected) ?? null;
  const same = !!current && current.providerCode === selected;
  const [values, setValues] = useState<Record<string, string>>(() => initialValues(provider, same ? current!.values : {}));
  const [events, setEvents] = useState<Record<SmsEvent, SmsEventSetting>>(() => ({ ...defaultSmsEvents(), ...(current?.settings.events ?? {}) } as Record<SmsEvent, SmsEventSetting>));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [phone, setPhone] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const choose = (p: ProviderView) => {
    setSelected(p.code);
    errors.clear();
    if (p.status !== "ready") {
      notify.error(notIntegratedMessage(p), { fallback: notIntegratedMessage(p) });
      return;
    }
    setValues(initialValues(p, current?.providerCode === p.code ? current.values : {}));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !provider || provider.status !== "ready") return;
    setSaving(true);
    errors.clear();
    try {
      await integrationsApi.provider.save(kind, {
        providerCode: provider.code, values: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "")),
        ...(kind === "sms" ? { events } : {}), expectedUpdatedAt: current?.updatedAt ?? null,
      });
      notify.success(current ? `${provider.name} bağlantısı güncellendi` : `${provider.name} bağlandı`, { description: "Bilgileri denemek için test düğmesini kullanın." });
      router.refresh();
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Entegrasyon kaydedilemedi." });
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await integrationsApi.provider.test(kind, kind === "sms" ? phone : undefined);
      notify.success(kind === "sms" ? "Test SMS'i gönderildi" : `${r.data.provider} bağlantısı çalışıyor`,
        { description: `${r.data.to ? `${r.data.to} · ` : ""}${(r.data.latencyMs / 1000).toFixed(1)} sn` });
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Bağlantı test edilemedi." });
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    if (!current) return;
    setRemoving(true);
    try {
      await integrationsApi.provider.remove(kind, current.updatedAt);
      notify.success("Entegrasyon kaldırıldı");
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "Entegrasyon kaldırılamadı." });
      setRemoving(false);
      setConfirmRemove(false);
    }
  };

  const Icon = copy.icon;
  const connectedReady = !!current && currentProvider?.status === "ready";

  return (
    <div className="space-y-6">
      <AdminPageHeader title={copy.title} subtitle={copy.subtitle} />

      <AdminCard className="max-w-5xl">
        <AdminCardTitle title="Mevcut durum" actions={connectedReady ? <AdminBadge tone="green">Bağlı</AdminBadge> : current ? <AdminBadge tone="amber">Adaptör yok</AdminBadge> : <AdminBadge>Bağlı değil</AdminBadge>} />
        {current ? (
          <div className="space-y-4 px-5 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="grid size-11 flex-none place-items-center rounded-xl bg-indigo-50 text-[#7367f0]"><Icon className="h-5 w-5" /></span>
                <div className="text-sm">
                  <p className="font-semibold text-slate-900">{current.providerName}</p>
                  <p className="text-xs text-slate-500">
                    {current.secretsSet.length ? "şifre kayıtlı · " : ""}son güncelleme {dt.format(new Date(current.updatedAt))}
                    {kind === "sms" && current.settings.events ? ` · ${Object.values(current.settings.events).filter((e) => e?.enabled).length} bildirim açık` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {connectedReady && kind === "sms" && (
                  <input aria-label="Test SMS'i gidecek telefon" inputMode="tel" placeholder="5XX XXX XX XX" value={phone}
                    onChange={(e) => { setPhone(e.target.value); errors.clear("phone"); }} aria-invalid={errors.has("phone")} className={`${inputCls} h-9 w-40`} />
                )}
                {connectedReady && (
                  <button type="button" onClick={test} disabled={testing} className={btn}>
                    {kind === "sms" ? <Send className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                    {testing ? "Deneniyor…" : kind === "sms" ? "Test SMS'i gönder" : "Bağlantıyı test et"}
                  </button>
                )}
                <button type="button" onClick={() => setConfirmRemove(true)} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" /> Kaldır
                </button>
              </div>
            </div>
            {errors.get("phone") && <p className="text-xs text-red-600">{errors.get("phone")}</p>}
            {!connectedReady && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">
                Bu kayıt için uygulamada adaptör yok; {kind === "sms" ? "SMS gönderilmez" : "gönderiler manuel işlenir (takip no elle girilir)"}. Aşağıdan hazır bir firma seçin.
              </p>
            )}
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-slate-600">
            {kind === "sms" ? "SMS firması bağlı değil; müşteriye sipariş SMS'i gitmez." : "Kargo firması bağlı değil; “Kargoya ver” derken takip numarasını elle girersiniz."} Aşağıdan firmanızı seçin.
          </p>
        )}
      </AdminCard>

      <AdminCard className="max-w-5xl">
        <AdminCardTitle title={kind === "sms" ? "SMS firması" : "Kargo firması"} subtitle="Çalıştığınız firmayı seçin. “Hazır” olanların entegrasyonu uygulamada bulunur." />
        <div className="grid gap-3 px-5 py-5 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Firma">
          {providers.map((p) => {
            const on = p.code === selected;
            return (
              <button key={p.code} type="button" role="radio" aria-checked={on} onClick={() => choose(p)}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${on ? (p.status === "ready" ? "border-[#7367f0] bg-indigo-50/50 ring-2 ring-[#7367f0]/15" : "border-red-300 bg-red-50/40 ring-2 ring-red-100") : "border-slate-200 hover:bg-slate-50"}`}>
                <span className={`grid size-10 flex-none place-items-center rounded-lg text-sm font-bold ${p.status === "ready" ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-500"}`}>
                  {p.name.trim().charAt(0).toLocaleUpperCase("tr-TR")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-slate-900">{p.name}</span>
                    {p.code === current?.providerCode && <AdminBadge tone="purple">Bağlı</AdminBadge>}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">{p.description}</span>
                  <span className="mt-1.5 block">{p.status === "ready" ? <AdminBadge tone="green">Hazır</AdminBadge> : <AdminBadge>Entegrasyon yok</AdminBadge>}</span>
                </span>
              </button>
            );
          })}
        </div>

        {provider && provider.status !== "ready" && (
          <div role="alert" className="mx-5 mb-5 flex items-start gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <div>
              <p className="font-semibold">{provider.name} entegrasyonu yok</p>
              <p className="mt-0.5">{notIntegratedMessage(provider)}</p>
            </div>
          </div>
        )}

        {provider && provider.status === "ready" && (
          <form onSubmit={save} noValidate className="space-y-5 border-t border-slate-100 px-5 py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><KeyRound className="h-4 w-4 text-[#7367f0]" /> {provider.name} API bilgileri</p>
              {provider.website && (
                <a href={provider.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[#7367f0] hover:underline">
                  Firma sitesi <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            {current && !same && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">
                Kaydettiğinizde mevcut <b>{current.providerName}</b> bağlantısı ve şifreleri silinir, yerine {provider.name} geçer.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {provider.fields.map((f) => {
                const id = `int-${f.key}`;
                const stored = same && f.secret && current!.secretsSet.includes(f.key);
                const err = errors.get(`values.${f.key}`);
                const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setValues((v) => ({ ...v, [f.key]: e.target.value })); errors.clear(`values.${f.key}`); };
                return (
                  <Field key={f.key} id={id} label={f.label} required={f.required && !stored} error={err}
                    hint={stored ? "Kayıtlı ve gösterilmez. Değiştirmeyecekseniz boş bırakın." : f.secret ? `${f.hint ? `${f.hint} ` : ""}Şifrelenerek saklanır.` : f.hint}>
                    {f.type === "select" ? (
                      <select id={id} className={`${inputCls} h-10`} value={values[f.key] ?? ""} onChange={onChange} aria-invalid={!!err}>
                        {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input id={id} type={f.type === "password" ? "password" : "text"} autoComplete={f.secret ? "new-password" : "off"} spellCheck={false}
                        className={`${inputCls} h-10 ${f.secret ? "font-mono" : ""}`} value={values[f.key] ?? ""} maxLength={f.maxLength}
                        placeholder={stored ? "••••••••••••" : f.placeholder} onChange={onChange} aria-invalid={!!err} />
                    )}
                  </Field>
                );
              })}
            </div>

            {kind === "sms" && <SmsEventsEditor events={events} onChange={setEvents} errors={errors} />}
            {kind === "shipping" && (
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600 ring-1 ring-slate-100">
                <p className="font-semibold text-slate-700">Nasıl çalışır?</p>
                <p>Siparişte “Kargoya ver” dediğinizde gönderi {provider.name} sistemine kaydedilir (takip numarası boş bırakılabilir).
                  Şube gönderiyi kabul edince takip numarası ve teslim durumu otomatik çekilir; müşteriye “Takip numarası oluştu” SMS’i gidebilir.
                  Otomatik sorgu için sunucuda <code className="rounded bg-white px-1">/api/cron/shipping-sync</code> 15–30 dakikada bir çağrılmalıdır.</p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
              <button type="submit" disabled={saving} className={primary}>
                <PlugZap className="h-4 w-4" />
                {saving ? (current ? "Güncelleniyor…" : "Bağlanıyor…") : same ? "Güncelle" : `${provider.name} bağla`}
              </button>
            </div>
          </form>
        )}
      </AdminCard>

      <AdminConfirmDialog open={confirmRemove} title="Entegrasyon kaldırılsın mı?"
        description={kind === "sms" ? "Firma bilgileri ve şifreler silinir; müşterilere SMS gönderimi durur." : "Firma bilgileri ve şifreler silinir; yeni gönderiler manuel işlenir. Kayıtlı gönderilerin takibi durur."}
        confirmLabel="Evet, kaldır" busyLabel="Kaldırılıyor…" busy={removing} onConfirm={remove} onCancel={() => setConfirmRemove(false)} />
    </div>
  );
}

function initialValues(p: ProviderView | null, stored: Record<string, string>): Record<string, string> {
  if (!p) return {};
  return Object.fromEntries(p.fields.map((f) => [f.key, f.secret ? "" : (stored[f.key] ?? f.default ?? (f.type === "select" ? (f.options?.[0]?.value ?? "") : ""))]));
}

function SmsEventsEditor({ events, onChange, errors }: {
  events: Record<SmsEvent, SmsEventSetting>;
  onChange: (e: Record<SmsEvent, SmsEventSetting>) => void;
  errors: ReturnType<typeof useFieldErrors>;
}) {
  const set = (k: SmsEvent, patch: Partial<SmsEventSetting>) => {
    onChange({ ...events, [k]: { ...events[k], ...patch } });
    errors.clear(`events.${k}.template`);
  };
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-slate-800">Bildirimler</p>
        <p className="text-xs text-slate-500">Hangi durumda müşteriye SMS gideceğini ve metnini seçin. Değişkenler gönderimde doldurulur; boş kalanlar silinir.</p>
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {SMS_EVENTS.map((k) => {
          const e = events[k];
          const info = SMS_EVENT_INFO[k];
          const preview = renderTemplate(e.template, SAMPLE);
          const err = errors.get(`events.${k}.template`);
          return (
            <li key={k} className="space-y-2 px-4 py-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" role="switch" className="peer sr-only" checked={e.enabled} onChange={(x) => set(k, { enabled: x.target.checked })} />
                <span aria-hidden className="relative mt-0.5 h-5 w-9 flex-none rounded-full bg-slate-200 transition peer-checked:bg-[#7367f0] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#7367f0] after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4" />
                <span>
                  <span className="block text-sm font-medium text-slate-800">{info.label}</span>
                  <span className="block text-xs text-slate-500">{info.hint}</span>
                </span>
              </label>
              {e.enabled && (
                <div className="space-y-2 pl-12">
                  <textarea aria-label={`${info.label} SMS metni`} rows={2} maxLength={SMS_TEMPLATE_MAX} value={e.template}
                    onChange={(x) => set(k, { template: x.target.value })} aria-invalid={!!err} className={`${inputCls} min-h-16 py-2`} />
                  {err && <p className="text-xs text-red-600">{err}</p>}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {SMS_VARIABLES.map((v) => (
                      <button key={v.key} type="button" onClick={() => set(k, { template: `${e.template}{{${v.key}}}`.slice(0, SMS_TEMPLATE_MAX) })}
                        className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 hover:bg-indigo-50 hover:text-[#5b4fe0]" title={v.label}>
                        {`{{${v.key}}}`}
                      </button>
                    ))}
                    <button type="button" onClick={() => set(k, { template: info.template })} className="ml-auto text-xs font-medium text-[#7367f0] hover:underline">Varsayılana dön</button>
                  </div>
                  <p className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-500" />
                    <span><span className="text-slate-400">Önizleme:</span> {preview} <span className="text-slate-400">· {preview.length} karakter ≈ {smsParts(preview)} SMS</span></span>
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
