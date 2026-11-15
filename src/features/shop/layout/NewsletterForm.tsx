"use client";

import Link from "next/link";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { useFieldErrors } from "@/lib/use-field-errors";
import { errorMessage } from "@/lib/api-client";
import { useCaptcha } from "../../captcha/useCaptcha";
import { newsletterApi } from "../data/newsletter-api";

/**
 * Footer e-bülten sign-up (client island). Double opt-in: after sending, the form is replaced by "check your inbox";
 * the answer is the same for every address. Signed-in members get their account e-mail prefilled.
 */
export function NewsletterForm({ kvkkHref, email: initialEmail }: { kvkkHref: string | null; email: string | null }) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errors = useFieldErrors();
  const captcha = useCaptcha("newsletter");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); errors.clear();
    try {
      const r = await newsletterApi.subscribe(email.trim(), await captcha.headers());
      setSent(r.message);
    } catch (err) {
      if (!errors.fromError(err)) setError(errorMessage(err));
    } finally {
      captcha.reset();
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <p role="status" className="flex items-start gap-3 rounded-2xl bg-white/10 px-4 py-3.5 text-sm leading-relaxed text-white/90">
        <MailCheck className="mt-0.5 size-5 flex-none text-dept-3" aria-hidden />{sent}
      </p>
    );
  }

  const emailError = errors.get("email");
  const consentError = errors.get("consent");
  return (
    <form onSubmit={submit} noValidate className="w-full max-w-xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:rounded-full sm:bg-white sm:p-1.5">
        <label htmlFor="nl-email" className="sr-only">E-posta adresiniz</label>
        <input id="nl-email" type="email" autoComplete="email" required value={email} onChange={(e) => { setEmail(e.target.value); errors.clear("email"); }}
          placeholder="E-posta adresiniz" aria-invalid={!!emailError} aria-describedby={emailError ? "nl-email-err" : undefined}
          className="h-12 min-w-0 flex-1 rounded-full bg-white px-5 text-[15px] text-ink outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-brand sm:h-11 sm:px-4 sm:focus-visible:ring-0" />
        <button type="submit" disabled={busy || !consent}
          className="h-12 flex-none rounded-full bg-brand px-6 text-[15px] font-semibold text-white transition hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60 sm:h-11">
          {busy ? "Gönderiliyor…" : "Kayıt ol"}
        </button>
      </div>
      {emailError ? <p id="nl-email-err" className="mt-2 text-xs text-red-300">{emailError}</p> : null}
      <label className="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-white/70">
        <input type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); errors.clear("consent"); }} className="mt-0.5 size-4 flex-none accent-brand" />
        <span>
          Kampanya ve yeniliklerle ilgili ticari elektronik ileti almayı kabul ediyorum.
          {kvkkHref ? <> <Link href={kvkkHref} target="_blank" className="underline decoration-white/40 underline-offset-2 hover:text-white">Aydınlatma metni</Link></> : null}
        </span>
      </label>
      {consentError ? <p className="mt-1 text-xs text-red-300">{consentError}</p> : null}
      {captcha.slot}
      {error || captcha.error ? <p role="alert" className="mt-2 text-xs text-red-300">{error || captcha.error}</p> : null}
    </form>
  );
}
