"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { Field, inputCls } from "@/components/admin/form";
import type { Channel, MetaAppView } from "@/modules/social-ai";
import { socialAiApi } from "./api";
import { HelpField, primary } from "./ui";

function CopyRow({ label, value, hint }: { label: string; value: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      notify.warning("Kopyalanamadı; metni elle seçip kopyalayın.");
    }
  };
  return (
    <div>
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">{value}</code>
        <button type="button" onClick={() => void copy()} className="inline-flex h-8 flex-none items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

/**
 * The shop's own Meta app — filled in once by whoever installs the shop, not by the shop owner. Closed by default once
 * the fields this channel needs are there.
 */
export function MetaAppCard({ channel, app, ready, onSaved }: { channel: Channel; app: MetaAppView; ready: boolean; onSaved: () => void }) {
  const errors = useFieldErrors();
  const [form, setForm] = useState({ appId: app.appId ?? "", appSecret: "", igAppId: app.igAppId ?? "", igAppSecret: "", waConfigId: app.waConfigId ?? "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm((f) => ({ ...f, [k]: e.target.value })); errors.clear(k); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await socialAiApi.saveApp({ ...form, expectedUpdatedAt: app.updatedAt });
      notify.success("Meta uygulama bilgileri güncellendi");
      onSaved();
    } catch (err) {
      errors.fromError(err);
      notify.error(err);
    } finally {
      setBusy(false);
    }
  };

  const wa = channel === "whatsapp";
  return (
    <details open={!ready} className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-base font-semibold text-slate-900">Meta uygulaması</span>
          <span className="mt-0.5 block text-xs text-slate-500">Kurulumu yapan firma bir kez doldurur. Mağaza sahibinin bu bölümle işi yoktur.</span>
        </span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{ready ? "Hazır" : "Eksik bilgi var"}</span>
      </summary>
      <div className="grid gap-6 border-t border-slate-200 px-5 py-5 lg:grid-cols-2">
        <form onSubmit={save} noValidate className="grid content-start gap-4">
          {wa ? (
            <>
              <HelpField name="App ID" steps={[
                <>developers.facebook.com/apps adresine Facebook hesabınızla girin. Uygulamanız yoksa “Uygulama oluştur” ile <strong>İşletme</strong> türünde bir uygulama açıp <strong>WhatsApp</strong> ürününü ekleyin.</>,
                <>Sol menüden <strong>Uygulama ayarları › Temel</strong> sayfasını açın.</>,
                <>Sayfanın en üstündeki <strong>Uygulama Kimliği (App ID)</strong> numarasını kopyalayıp buraya yapıştırın.</>,
              ]}>
                <Field id="meta-app-id" label="App ID" required error={errors.get("appId")} hint="Meta for Developers › uygulamanız › Uygulama ayarları › Temel.">
                  <input id="meta-app-id" inputMode="numeric" autoComplete="off" className={`${inputCls} h-10`} value={form.appId} onChange={set("appId")} aria-invalid={errors.has("appId")} />
                </Field>
              </HelpField>
              <HelpField name="App Secret" note="Bu anahtar şifre gibidir; kimseyle paylaşmayın." steps={[
                <>App ID ile aynı sayfadadır: <strong>Uygulama ayarları › Temel</strong>.</>,
                <><strong>Uygulama Gizli Anahtarı (App Secret)</strong> satırındaki <strong>Göster</strong> düğmesine basın; Facebook şifreniz sorulur.</>,
                <>Görünen anahtarı kopyalayıp buraya yapıştırın.</>,
              ]}>
                <Field id="meta-app-secret" label="App Secret" required={!app.appSecretSet} error={errors.get("appSecret")} hint={app.appSecretSet ? "Kayıtlı; değiştirmek için yazın." : "Şifreli saklanır, bir daha gösterilmez."}>
                  <input id="meta-app-secret" type="password" autoComplete="new-password" className={`${inputCls} h-10`} value={form.appSecret} onChange={set("appSecret")} aria-invalid={errors.has("appSecret")} />
                </Field>
              </HelpField>
              <HelpField name="Embedded Signup yapılandırma kimliği" steps={[
                <>Uygulamanıza <strong>Facebook Login for Business</strong> ürününü ekleyin.</>,
                <>Sol menüden <strong>Facebook Login for Business › Configurations</strong> sayfasını açıp <strong>Create configuration</strong> düğmesine basın.</>,
                <>Giriş türü olarak <strong>WhatsApp Embedded Signup</strong> seçin; izinlerde <strong>whatsapp_business_management</strong> ve <strong>whatsapp_business_messaging</strong> işaretli olsun.</>,
                <>Kaydedince listede görünen <strong>Configuration ID</strong> numarasını kopyalayıp buraya yapıştırın.</>,
              ]}>
                <Field id="meta-wa-config" label="Embedded Signup yapılandırma kimliği" required error={errors.get("waConfigId")} hint="Facebook Login for Business › Configurations altında oluşturulan WhatsApp Embedded Signup yapılandırması.">
                  <input id="meta-wa-config" inputMode="numeric" autoComplete="off" className={`${inputCls} h-10`} value={form.waConfigId} onChange={set("waConfigId")} aria-invalid={errors.has("waConfigId")} />
                </Field>
              </HelpField>
            </>
          ) : (
            <>
              <HelpField name="Instagram App ID" note="Dikkat: Uygulama ayarları › Temel sayfasındaki App ID bu değildir; Instagram'ın kendi numarası ayrıdır." steps={[
                <>developers.facebook.com/apps adresine Facebook hesabınızla girin. Uygulamanız yoksa “Uygulama oluştur” ile <strong>İşletme</strong> türünde bir uygulama açıp <strong>Instagram</strong> ürününü ekleyin.</>,
                <>Sol menüden <strong>Instagram › API setup with Instagram login</strong> (Instagram girişiyle API kurulumu) sayfasını açın.</>,
                <>Sayfanın en üstündeki <strong>Instagram app ID</strong> numarasını kopyalayıp buraya yapıştırın.</>,
              ]}>
                <Field id="meta-ig-app-id" label="Instagram App ID" required error={errors.get("igAppId")} hint="Uygulamanız › Instagram › “API setup with Instagram login” bölümü.">
                  <input id="meta-ig-app-id" inputMode="numeric" autoComplete="off" className={`${inputCls} h-10`} value={form.igAppId} onChange={set("igAppId")} aria-invalid={errors.has("igAppId")} />
                </Field>
              </HelpField>
              <HelpField name="Instagram App Secret" note="Bu anahtar şifre gibidir; kimseyle paylaşmayın." steps={[
                <>Instagram App ID ile aynı sayfadadır: <strong>Instagram › API setup with Instagram login</strong>.</>,
                <>App ID&apos;nin hemen yanındaki <strong>Instagram app secret</strong> alanında <strong>Göster</strong> düğmesine basın; Facebook şifreniz sorulur.</>,
                <>Görünen anahtarı kopyalayıp buraya yapıştırın.</>,
              ]}>
                <Field id="meta-ig-app-secret" label="Instagram App Secret" required={!app.igAppSecretSet} error={errors.get("igAppSecret")} hint={app.igAppSecretSet ? "Kayıtlı; değiştirmek için yazın." : "Şifreli saklanır, bir daha gösterilmez."}>
                  <input id="meta-ig-app-secret" type="password" autoComplete="new-password" className={`${inputCls} h-10`} value={form.igAppSecret} onChange={set("igAppSecret")} aria-invalid={errors.has("igAppSecret")} />
                </Field>
              </HelpField>
            </>
          )}
          <div><button type="submit" disabled={busy} className={primary}>{busy ? "Güncelleniyor…" : "Güncelle"}</button></div>
        </form>
        <div className="grid content-start gap-4">
          <p className="text-sm text-slate-600">Meta uygulamanızın webhook ayarına aşağıdaki iki değeri girin ve <strong className="font-semibold text-slate-800">{wa ? "messages" : "messages, messaging_postbacks, messaging_referral"}</strong> alanlarına abone olun.</p>
          {app.webhookUrl.startsWith("https://") ? null : (
            <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">Bu adres Meta&apos;da doğrulanamaz: Meta yalnız internetten erişilebilen <strong className="font-semibold">https</strong> adreslere bağlanır, <strong className="font-semibold">localhost</strong> sizin bilgisayarınızdır. Canlı alan adında kurun ya da denemek için bir https tünel adresi (ör. cloudflared) açıp <code>PUBLIC_SITE_URL</code> değerini o adres yapın.</p>
          )}
          <CopyRow label="Webhook adresi (Callback URL)" value={app.webhookUrl} hint="WhatsApp ve Instagram için aynı adres kullanılır." />
          <CopyRow label="Doğrulama anahtarı (Verify token)" value={app.verifyToken} hint="Meta bu anahtarla adresin size ait olduğunu doğrular." />
          {wa ? null : <CopyRow label="Yönlendirme adresi (OAuth redirect URI)" value={app.instagramRedirectUri} hint="Instagram › Business login settings altına eklenir." />}
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">Kendi hesabınız dışındaki müşterilere cevap verebilmek için uygulamanın Meta App Review onayından geçmesi gerekir; bu süreç haftalar sürebilir.</p>
        </div>
      </div>
    </details>
  );
}
