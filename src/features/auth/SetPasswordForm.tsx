"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { errorMessage } from "@/lib/api-client";
import { useFieldErrors } from "@/lib/use-field-errors";
import { passwordProblems } from "@/modules/identity/domain/password-policy";
import { authApi } from "./api";
import { PasswordField } from "./PasswordField";

/** Sets the password from a one-time link (staff invitation / reset, customer reset). */
export function SetPasswordForm({ token, email, displayName, tone, submitLabel }: {
  token: string;
  email: string;
  displayName: string;
  tone: "admin" | "storefront";
  submitLabel: string;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const errors = useFieldErrors();
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length > 0 && passwordProblems(password, { email, name: displayName }).length === 0 && confirm === password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    errors.clear();
    try {
      const r = await authApi.setPassword(token, password);
      setDone(r.data.loginPath);
    } catch (err) {
      errors.fromError(err);
      setError(errorMessage(err, "Parola belirlenemedi."));
    } finally {
      setBusy(false);
    }
  };

  const primary = tone === "admin"
    ? "inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white transition hover:bg-[#6559df] disabled:opacity-60"
    : "btn btn-primary w-full";

  if (done) {
    return (
      <div role="status" className="space-y-4">
        <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 size-4 flex-none" aria-hidden />Parolanız belirlendi. Artık giriş yapabilirsiniz; açık oturumlarınız güvenlik için kapatıldı.</p>
        <Link href={`${done}?email=${encodeURIComponent(email)}`} className={primary}>Giriş sayfasına git</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <PasswordField id="new-password" label="Yeni parola" value={password} onChange={setPassword} context={{ email, name: displayName }} error={errors.get("password")} tone={tone} autoFocus />
      <div>
        <label htmlFor="confirm-password" className={tone === "admin" ? "mb-1 block text-sm font-medium text-slate-700" : "mb-1 block text-sm font-medium"}>Yeni parola (tekrar)</label>
        <input id="confirm-password" type="password" autoComplete="new-password" value={confirm} maxLength={128} aria-invalid={mismatch}
          className={tone === "admin" ? "input h-11 border-slate-300 text-slate-800" : "input"} onChange={(e) => setConfirm(e.target.value)} />
        {mismatch ? <p className="mt-1 text-xs text-red-600">Parolalar aynı değil.</p> : null}
      </div>
      {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <button type="submit" disabled={!valid || busy} className={primary}>{busy ? "Bekleyin…" : submitLabel}</button>
    </form>
  );
}
