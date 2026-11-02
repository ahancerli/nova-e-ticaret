"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/lib/api-client";
import { authApi, type LoginAudience } from "./api";
import { safeInternalPath } from "@/lib/safe-redirect";

interface LoginFormProps {
  audience: LoginAudience;
  fallbackTarget?: string;
  submitLabel?: string;
  card?: boolean;
  formClassName?: string;
  inputClassName?: string;
  buttonClassName?: string;
  emailPlaceholder?: string;
  passwordPlaceholder?: string;
}

export function LoginForm({
  audience,
  fallbackTarget = "/",
  submitLabel = "Giriş yap",
  card = true,
  formClassName,
  inputClassName,
  buttonClassName,
  emailPlaceholder,
  passwordPlaceholder,
}: LoginFormProps) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  // Prefilled after setting a password from an invitation / reset link.
  const prefillEmail = params.get("email")?.slice(0, 254) ?? undefined;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = safeInternalPath(next, fallbackTarget);
  const formBase = card ? "card space-y-4 p-6" : "space-y-4";
  const inputBase = inputClassName ?? "input";
  const buttonBase = buttonClassName ?? "btn btn-primary w-full";

  return (
    <form className={`${formBase}${formClassName ? ` ${formClassName}` : ""}`} onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setError(null);
      const f = new FormData(e.currentTarget);
      try {
        await authApi.login(audience, { email: String(f.get("email")), password: String(f.get("password")) });
        router.replace(target);
        router.refresh();
      } catch (err) {
        setError(errorMessage(err, "Giriş yapılamadı."));
      } finally { setBusy(false); }
    }}>
      <div><label htmlFor="email" className="mb-1 block text-sm font-medium">E-posta</label><input id="email" name="email" type="email" required autoComplete="username" placeholder={emailPlaceholder} defaultValue={prefillEmail} className={inputBase} /></div>
      <div><label htmlFor="password" className="mb-1 block text-sm font-medium">Parola</label><input id="password" name="password" type="password" required autoComplete="current-password" placeholder={passwordPlaceholder} className={inputBase} /></div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button className={buttonBase} disabled={busy}>{busy ? "Giriş yapılıyor…" : submitLabel}</button>
    </form>
  );
}
