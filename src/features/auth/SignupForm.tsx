"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/lib/api-client";
import { useFieldErrors } from "@/lib/use-field-errors";
import { passwordProblems } from "@/modules/identity/domain/password-policy";
import type { SignupLegal } from "@/modules/content";
import { track } from "@/features/consent/track";
import { useCaptcha } from "@/features/captcha/useCaptcha";
import { PhoneField } from "@/features/geo/PhoneField";
import { authApi } from "./api";
import { PasswordField } from "./PasswordField";

/**
 * Storefront sign-up. KVKK: the notice acknowledgement is required; commercial messages (İYS) are separate,
 * unticked opt-ins. The person chooses the password (same policy as the server).
 */
export function SignupForm({ legal, next = "/hesabim?hosgeldin=1" }: { legal: SignupLegal; next?: string }) {
  const router = useRouter();
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", phone: "", phoneCountry: "TR", password: "", kvkkAccepted: false, marketingEmail: false, marketingSms: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errors = useFieldErrors();
  const captcha = useCaptcha("signup");
  const fe = errors.get;
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));
  const name = `${f.firstName} ${f.lastName}`.trim();
  const passwordOk = passwordProblems(f.password, { email: f.email, name }).length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!passwordOk) {
      errors.set({ password: ["Parola kurallarını sağlayın."] });
      return;
    }
    setBusy(true);
    setError("");
    errors.clear();
    try {
      await authApi.register(f, await captcha.headers());
      track({ name: "sign_up", method: "email" });
      router.push(next);
      router.refresh();
    } catch (err) {
      const n = errors.fromError(err);
      setError(n ? "İşaretli alanları kontrol edin." : errorMessage(err, "Üyelik oluşturulamadı."));
      captcha.reset();
      setBusy(false);
    }
  };

  const field = (id: keyof typeof f, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={id} className="input" value={String(f[id])} aria-invalid={!!fe(id)} onChange={(e) => set({ [id]: e.target.value })} {...props} />
      {fe(id) ? <p className="mt-1 text-xs text-danger">{fe(id)}</p> : null}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {field("firstName", "Ad", { autoComplete: "given-name", maxLength: 80, required: true })}
        {field("lastName", "Soyad", { autoComplete: "family-name", maxLength: 80, required: true })}
      </div>
      {field("email", "E-posta", { type: "email", autoComplete: "email", maxLength: 254, required: true })}
      <PhoneField id="phone" label="Cep telefonu (isteğe bağlı)" error={fe("phone")} onChange={(phone, phoneCountry) => { set({ phone, phoneCountry }); errors.clear("phone"); }} />
      <PasswordField id="password" label="Parola" value={f.password} onChange={(password) => set({ password })} context={{ email: f.email, name }} error={fe("password")} tone="storefront" />

      <fieldset className="space-y-3 border-t border-line pt-4 text-sm">
        <legend className="sr-only">Onaylar</legend>
        <label className="flex gap-2">
          <input type="checkbox" className="mt-0.5 size-4 flex-none accent-brand" checked={f.kvkkAccepted} onChange={(e) => set({ kvkkAccepted: e.target.checked })} aria-invalid={!!fe("kvkkAccepted")} />
          <span>
            {legal.kvkk ? <Link href={legal.kvkk.href} target="_blank" rel="noopener" className="underline">KVKK aydınlatma metnini</Link> : "KVKK aydınlatma metnini"} okudum
            {legal.membership ? <> ve <Link href={legal.membership.href} target="_blank" rel="noopener" className="underline">üyelik sözleşmesini</Link> kabul ediyorum</> : null}.
          </span>
        </label>
        {fe("kvkkAccepted") ? <p className="text-xs text-danger">{fe("kvkkAccepted")}</p> : null}
        <p className="text-xs text-muted">Kampanya ve fırsatlardan haberdar olmak isterseniz (isteğe bağlı, istediğiniz zaman vazgeçebilirsiniz):</p>
        <label className="flex gap-2"><input type="checkbox" className="mt-0.5 size-4 flex-none accent-brand" checked={f.marketingEmail} onChange={(e) => set({ marketingEmail: e.target.checked })} />E-posta ile ticari ileti almak istiyorum.</label>
        <label className="flex gap-2"><input type="checkbox" className="mt-0.5 size-4 flex-none accent-brand" checked={f.marketingSms} onChange={(e) => set({ marketingSms: e.target.checked })} />SMS ile ticari ileti almak istiyorum.</label>
      </fieldset>

      {captcha.slot}
      {error || captcha.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error || captcha.error}</p> : null}
      <button type="submit" className="btn btn-primary w-full" disabled={busy || !f.kvkkAccepted}>{busy ? "Bekleyin…" : "Üye ol"}</button>
      <p className="text-center text-sm text-ink-soft">Zaten üye misiniz? <Link href={next.startsWith("/hesabim") ? "/giris" : `/giris?next=${encodeURIComponent(next)}`} className="font-medium text-brand hover:underline">Giriş yapın</Link></p>
    </form>
  );
}
