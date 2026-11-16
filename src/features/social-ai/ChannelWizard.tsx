"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { errorMessage } from "@/lib/api-client";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { Field, inputCls } from "@/components/admin/form";
import type { Channel, ChannelOverview } from "@/modules/social-ai";
import { CHANNELS, META_GRAPH_VERSION } from "@/modules/social-ai/domain/social-ai";
import { socialAiApi } from "./api";
import { AI_PAGE, ChannelMark, HelpField, btn, primary } from "./ui";

type StepState = "done" | "current" | "todo";

/** One step of the set-up: a real sequence, so the rail is numbered. */
function Step({ n, title, state, children }: { n: number; title: string; state: StepState; children?: ReactNode }) {
  return (
    <li className="relative pl-12 pb-7 last:pb-0">
      <span aria-hidden className="absolute left-[15px] top-8 bottom-0 w-px bg-slate-200 [li:last-child>&]:hidden" />
      <span aria-hidden className={`absolute left-0 top-0 flex size-8 items-center justify-center rounded-full text-sm font-semibold ${state === "done" ? "bg-emerald-500 text-white" : state === "current" ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-400"}`}>
        {state === "done" ? <Check className="h-4 w-4" /> : n}
      </span>
      <h3 className={`pt-1 text-sm font-semibold ${state === "todo" ? "text-slate-400" : "text-slate-900"}`}>{title}<span className="sr-only">{state === "done" ? " (tamamlandı)" : state === "current" ? " (şimdi)" : ""}</span></h3>
      {state === "todo" ? null : <div className="mt-2 space-y-3 text-sm text-slate-600">{children}</div>}
    </li>
  );
}

function Check2({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" className="mt-0.5 size-4 accent-[#7367f0]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

interface FacebookSdk {
  init(o: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (r: { authResponse?: { code?: string } | null }) => void, o: Record<string, unknown>): void;
}
declare global { interface Window { FB?: FacebookSdk; fbAsyncInit?: () => void } }

/** Loads Meta's JS SDK once (WhatsApp Embedded Signup only works through it). */
function loadFacebookSdk(appId: string): Promise<FacebookSdk> {
  return new Promise((resolve, reject) => {
    const init = () => { window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version: META_GRAPH_VERSION }); resolve(window.FB!); };
    if (window.FB) return init();
    window.fbAsyncInit = init;
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("sdk"));
    document.head.appendChild(s);
  });
}

/** Development / fallback: ids and a token typed in by hand. */
function ManualConnect({ channel, disabled, onConnected }: { channel: Channel; disabled: boolean; onConnected: () => void }) {
  const errors = useFieldErrors();
  const [form, setForm] = useState({ externalId: "", accountId: "", accessToken: "" });
  const [busy, setBusy] = useState(false);
  const wa = channel === "whatsapp";
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await socialAiApi.connectManually(channel, { externalId: form.externalId, accountId: form.accountId || null, accessToken: form.accessToken });
      notify.success(`${CHANNELS[channel].label} bağlandı`);
      onConnected();
    } catch (err) {
      errors.fromError(err);
      notify.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-5 py-4 text-sm">
      <summary className="cursor-pointer font-medium text-slate-600">Bilgileri elle gir (geliştirici / yedek yol)</summary>
      <form onSubmit={submit} noValidate className="mt-4 grid max-w-xl gap-4">
        <p className="text-xs text-slate-500">Meta panelinden aldığınız kimlik ve erişim anahtarıyla bağlanır. Anahtar kaydedilmeden önce Meta&apos;da denenir.</p>
        <HelpField name={wa ? "Telefon numarası kimliği" : "Instagram hesap kimliği"} steps={wa ? [
          <>developers.facebook.com/apps adresinde uygulamanızı açın.</>,
          <>Sol menüden <strong>WhatsApp › API Setup</strong> (API Kurulumu) sayfasına girin.</>,
          <>Numaranızın altında yazan <strong>Phone number ID</strong> değerini kopyalayın (telefon numarasının kendisi değil).</>,
        ] : [
          <>developers.facebook.com/apps adresinde uygulamanızı açın.</>,
          <>Sol menüden <strong>Instagram › API setup with Instagram login</strong> sayfasına girin.</>,
          <><strong>Generate access tokens</strong> bölümünde <strong>Add account</strong> ile Instagram hesabınızı ekleyin; hesabın yanında görünen numara hesap kimliğidir.</>,
        ]}>
          <Field id="manual-external" label={wa ? "Telefon numarası kimliği (Phone number ID)" : "Instagram hesap kimliği"} required error={errors.get("externalId")}>
            <input id="manual-external" inputMode="numeric" autoComplete="off" className={`${inputCls} h-10`} value={form.externalId} onChange={(e) => setForm((f) => ({ ...f, externalId: e.target.value }))} aria-invalid={errors.has("externalId")} />
          </Field>
        </HelpField>
        {wa ? (
          <HelpField name="WhatsApp Business hesap kimliği" steps={[
            <>Phone number ID ile aynı sayfadadır: <strong>WhatsApp › API Setup</strong>.</>,
            <><strong>WhatsApp Business Account ID</strong> satırındaki numarayı kopyalayın.</>,
          ]}>
            <Field id="manual-account" label="WhatsApp Business hesap kimliği (WABA ID)" error={errors.get("accountId")} hint="Girilirse mesaj bildirimleri (webhook) bu hesap için otomatik açılır.">
              <input id="manual-account" inputMode="numeric" autoComplete="off" className={`${inputCls} h-10`} value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))} aria-invalid={errors.has("accountId")} />
            </Field>
          </HelpField>
        ) : null}
        <HelpField name="Erişim anahtarı" note={wa ? "API Setup sayfasındaki geçici anahtar 24 saatte biter; kalıcı kullanım için sistem kullanıcısı anahtarı gerekir." : undefined} steps={wa ? [
          <>business.facebook.com/settings adresinde <strong>Kullanıcılar › Sistem kullanıcıları</strong> sayfasını açın; yoksa bir sistem kullanıcısı ekleyin.</>,
          <>Sistem kullanıcısına uygulamanızı ve WhatsApp hesabınızı varlık olarak atayın.</>,
          <><strong>Token oluştur</strong> düğmesine basın; süre olarak <strong>Hiçbir zaman</strong>, izin olarak <strong>whatsapp_business_messaging</strong> ve <strong>whatsapp_business_management</strong> seçin.</>,
          <>Oluşan anahtarı kopyalayıp buraya yapıştırın; Meta onu bir daha göstermez.</>,
        ] : [
          <>Hesap kimliğini aldığınız yerdedir: <strong>Instagram › API setup with Instagram login › Generate access tokens</strong>.</>,
          <>Hesabınızın yanındaki <strong>Generate token</strong> düğmesine basıp Instagram&apos;da izinleri onaylayın.</>,
          <>Görünen anahtarı kopyalayıp buraya yapıştırın; Meta onu bir daha göstermez.</>,
        ]}>
          <Field id="manual-token" label="Erişim anahtarı (Access token)" required error={errors.get("accessToken")} hint="Şifreli saklanır, bir daha gösterilmez.">
            <input id="manual-token" type="password" autoComplete="new-password" className={`${inputCls} h-10`} value={form.accessToken} onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))} aria-invalid={errors.has("accessToken")} />
          </Field>
        </HelpField>
        <div><button type="submit" disabled={busy || disabled} className={btn}>{busy ? "Bağlanıyor…" : "Bağlan"}</button></div>
      </form>
    </details>
  );
}

const IG_ERRORS: Record<string, string> = {
  social_ai_app_not_ready: "Meta uygulama bilgileri eksik. Aşağıdaki “Meta uygulaması” bölümünü kurulum firmanız doldurmalı.",
  social_ai_https_required: "Instagram yalnız https adreslere geri döner. Sitenin genel adresi https olmalı.",
  social_ai_ai_required: "Önce AI entegrasyonu yapılmalı.",
};

/**
 * Set-up wizard of a channel (shown until it is connected, never again afterwards). WhatsApp: Meta Embedded Signup in a
 * popup. Instagram: Instagram's own login page, which also asks which professional account to connect.
 */
export function ChannelWizard({ overview, callback, onConnected }: {
  overview: ChannelOverview;
  /** Instagram sent the browser back with these. */
  callback: { code: string | null; state: string | null; denied: boolean; error: string | null };
  onConnected: () => void;
}) {
  const { channel, ai, appReady, app } = overview;
  const wa = channel === "whatsapp";
  const label = CHANNELS[channel].label;
  const [ready, setReady] = useState({ a: false, b: false });
  const [phase, setPhase] = useState<"idle" | "popup" | "finishing">(callback.code || callback.denied ? "finishing" : "idle");
  const [problem, setProblem] = useState<string | null>(callback.error ? IG_ERRORS[callback.error] ?? "Bağlantı başlatılamadı. Tekrar deneyin." : null);
  const session = useRef<{ wabaId?: string; phoneNumberId?: string }>({});
  const finished = useRef(false);

  const fail = useCallback((err: unknown, fallback: string) => {
    setPhase("idle");
    setProblem(errorMessage(err, fallback));
  }, []);

  // Instagram: finish with the code the redirect brought (once).
  useEffect(() => {
    if (wa || finished.current || !(callback.code || callback.denied)) return;
    finished.current = true;
    socialAiApi.completeInstagram({ code: callback.code, state: callback.state, denied: callback.denied })
      .then(() => { notify.success("Instagram bağlandı"); onConnected(); })
      .catch((err: unknown) => fail(err, "Instagram bağlanamadı. “Instagram ile bağlan” düğmesine yeniden basın."));
  }, [wa, callback.code, callback.state, callback.denied, onConnected, fail]);

  // WhatsApp: the popup reports the chosen WABA and number through a window message, the code through FB.login.
  useEffect(() => {
    if (!wa) return;
    const onMessage = (event: MessageEvent) => {
      if (typeof event.origin !== "string" || !/^https:\/\/([a-z-]+\.)?facebook\.com$/.test(event.origin)) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (data.data?.waba_id && data.data?.phone_number_id) session.current = { wabaId: String(data.data.waba_id), phoneNumberId: String(data.data.phone_number_id) };
        if (data.event === "CANCEL") setProblem("Kurulum penceresi tamamlanmadan kapatıldı. Hazır olduğunuzda yeniden deneyin.");
        if (data.event === "ERROR") setProblem("Meta kurulum sırasında bir hata bildirdi. Bir süre sonra yeniden deneyin.");
      } catch { /* other messages from the SDK */ }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [wa]);

  const startWhatsApp = async () => {
    if (!app.appId || !app.waConfigId) return;
    setProblem(null);
    setPhase("popup");
    session.current = {};
    try {
      const FB = await loadFacebookSdk(app.appId);
      FB.login((response) => {
        const code = response.authResponse?.code;
        const { wabaId, phoneNumberId } = session.current;
        if (!code || !wabaId || !phoneNumberId) {
          setPhase("idle");
          setProblem((p) => p ?? "Kurulum tamamlanmadı. Pencerenin son adımında “Bitir” düğmesine basmanız gerekiyor.");
          return;
        }
        setPhase("finishing");
        // The code lives 30 seconds: exchanged right away.
        socialAiApi.connectWhatsApp({ code, wabaId, phoneNumberId })
          .then(() => { notify.success("WhatsApp bağlandı"); onConnected(); })
          .catch((err: unknown) => fail(err, "WhatsApp bağlanamadı. Yeniden deneyin."));
      }, { config_id: app.waConfigId, response_type: "code", override_default_response_type: true, extras: { setup: {} } });
    } catch {
      setPhase("idle");
      setProblem("Meta kurulum penceresi açılamadı. Reklam engelleyici kapalıyken yeniden deneyin.");
    }
  };

  const blocked = !ai.ready || !appReady || !overview.publicUrlIsHttps;
  const checked = ready.a && ready.b;
  const stepOf = (n: number): StepState => {
    const current = !ai.ready ? 1 : phase === "finishing" ? 4 : checked ? 3 : 2;
    return n < current ? "done" : n === current ? "current" : "todo";
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <ChannelMark channel={channel} />
          <div>
            <h2 className="text-base font-semibold text-slate-900">{label} kurulumu</h2>
            <p className="text-xs text-slate-500">Birkaç dakika sürer ve bir kez yapılır. Hiçbir kod ya da anahtar kopyalamanız gerekmez.</p>
          </div>
        </div>
        <ol className="px-5 py-6">
          <Step n={1} title="Yapay zekâ bağlantısı" state={stepOf(1)}>
            {ai.ready
              ? <p>Hazır. Mesajları mağazanızın bağlı modeli cevaplayacak{ai.model ? <> (<span className="font-medium text-slate-800">{ai.model}</span>)</> : null}.</p>
              : <><p>Bot, mağazanızın AI entegrasyonuyla çalışır. Henüz bir API anahtarı girilmemiş.</p><a href={AI_PAGE} className={primary}>AI entegrasyonlarına git</a></>}
          </Step>
          <Step n={2} title="Hazırlık" state={stepOf(2)}>
            <p>Başlamadan önce şu ikisinin tamam olduğundan emin olun:</p>
            {wa ? (
              <>
                <Check2 checked={ready.a} onChange={(a) => setReady((r) => ({ ...r, a }))}>Bir <strong className="font-semibold text-slate-800">Meta Business hesabım</strong> var (yoksa kurulum penceresinde ücretsiz açılır).</Check2>
                <Check2 checked={ready.b} onChange={(b) => setReady((r) => ({ ...r, b }))}>Bağlayacağım numara şu an <strong className="font-semibold text-slate-800">WhatsApp ya da WhatsApp Business uygulamasında kullanılmıyor</strong> ve SMS / arama alabiliyor.</Check2>
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs ring-1 ring-slate-200">Numara telefondaki WhatsApp&apos;ta kayıtlıysa önce oradan hesabı silmeniz gerekir: WhatsApp › Ayarlar › Hesap › Hesabımı sil.</p>
              </>
            ) : (
              <>
                <Check2 checked={ready.a} onChange={(a) => setReady((r) => ({ ...r, a }))}>Instagram hesabım <strong className="font-semibold text-slate-800">İşletme ya da İçerik üreticisi</strong> hesabı.</Check2>
                <Check2 checked={ready.b} onChange={(b) => setReady((r) => ({ ...r, b }))}>Instagram&apos;da <strong className="font-semibold text-slate-800">mesajlara erişim izni</strong> açık.</Check2>
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs ring-1 ring-slate-200">Hesap türü: Instagram › Ayarlar › Hesap türü ve araçlar › Profesyonel hesaba geç. Mesaj izni: Ayarlar › Mesajlar ve hikâye yanıtları › Mesaj kontrolleri › Bağlı araçlar › “Mesajlara erişime izin ver”.</p>
              </>
            )}
          </Step>
          <Step n={3} title={`${label} ile bağlan`} state={stepOf(3)}>
            {!appReady ? <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-amber-200">Meta uygulama bilgileri eksik. Aşağıdaki “Meta uygulaması” bölümünü kurulum firmanızın doldurması gerekiyor.</p> : null}
            {appReady && !overview.publicUrlIsHttps ? <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 ring-1 ring-amber-200">Meta yalnız https adreslerle çalışır. Bu site şu an https olmayan bir adreste yayınlanıyor; canlı alan adınızda deneyin ya da yedek yolu kullanın.</p> : null}
            <p>{wa ? "Açılan pencerede işletmenizi seçin, numaranızı girin ve SMS ile gelen kodu yazın. Son adımda “Bitir”e basın." : "Instagram’ın kendi giriş sayfası açılır. Birden fazla hesabınız varsa bağlamak istediğinizi orada seçin ve istenen izinleri onaylayın."}</p>
            {wa
              ? <button type="button" className={primary} disabled={blocked || phase !== "idle"} onClick={() => void startWhatsApp()}>{phase === "popup" ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Pencere açık…</> : "WhatsApp ile bağlan"}</button>
              : blocked ? <button type="button" className={primary} disabled>Instagram ile bağlan</button> : <a href="/api/admin/social-ai/instagram/start" className={primary}>Instagram ile bağlan</a>}
            {problem ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-800 ring-1 ring-red-100">{problem}</p> : null}
          </Step>
          <Step n={4} title="Bağlantı testi ve mesaj bildirimleri" state={stepOf(4)}>
            <p className="flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin text-[#7367f0]" /> Hesap doğrulanıyor, mesaj bildirimleri açılıyor…</p>
          </Step>
          <Step n={5} title="Hazır" state="todo" />
        </ol>
      </section>
      <ManualConnect channel={channel} disabled={!ai.ready} onConnected={onConnected} />
    </div>
  );
}
