"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/lib/api-client";
import { safeInternalPath } from "@/lib/safe-redirect";
import { useFieldErrors } from "@/lib/use-field-errors";
import type { SignupLegal } from "@/modules/content";
import { SOCIAL_PROVIDERS, type PendingSocialSignup } from "@/modules/social-login/domain/social";
import { track } from "@/features/consent/track";
import { authApi } from "./api";

/**
 * "Üyeliği tamamla": name prefilled from the provider (editable), the e-mail fixed (it is the one the provider
 * verified), and the same consents as the sign-up form — KVKK notice required, commercial messages separate opt-ins.
 */
export function SocialSignupForm({ pending, legal }: { pending: PendingSocialSignup; legal: SignupLegal }) {
  const router = useRouter();
  const provider = SOCIAL_PROVIDERS[pending.provider].label;
  const [f, setF] = useState({ firstName: pending.firstName, lastName: pending.lastName, kvkkAccepted: false, marketingEmail: false, marketingSms: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errors = useFieldErrors();
  const fe = errors.get;
  const set = (p: Partial<typeof f>) => setF((s) => ({ ...s, ...p }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    errors.clear();
    try {
      const { data } = await authApi.socialSignup(f);
      track({ name: "sign_up", method: pending.provider });
      router.replace(safeInternalPath(data.next, "/hesabim"));
      router.refresh();
    } catch (err) {
      const n = errors.fromError(err);
      setError(n ? "İşaretli alanları kontrol edin." : errorMessage(err, "Üyelik oluşturulamadı."));
      setBusy(false);
    }
  };

  const field = (id: "firstName" | "lastName", label: string, autoComplete: string) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={id} className="input" value={f[id]} maxLength={80} required autoComplete={autoComplete} aria-invalid={!!fe(id)} onChange={(e) => set({ [id]: e.target.value })} />
      {fe(id) ? <p className="mt-1 text-xs text-danger">{fe(id)}</p> : null}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="rounded-2xl bg-ground px-4 py-3 text-sm">
        <p className="text-ink-soft">{provider} hesabın</p>
        <p className="break-all font-semibold text-ink">{pending.email}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("firstName", "Ad", "given-name")}
        {field("lastName", "Soyad", "family-name")}
      </div>

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

      {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p> : null}
      <button type="submit" className="btn btn-primary w-full" disabled={busy || !f.kvkkAccepted}>{busy ? "Bekleyin…" : "Üyeliği tamamla"}</button>
      <p className="text-center text-sm text-ink-soft">Farklı bir hesapla mı devam edeceksin? <Link href="/giris" className="font-medium text-brand hover:underline">Giriş sayfasına dön</Link></p>
    </form>
  );
}
