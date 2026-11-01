"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, ClientApiError } from "@/lib/api-client";

interface LoginFormProps {
  endpoint: string;
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
  endpoint,
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
  const next = useSearchParams().get("next");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Only allow local redirects (open-redirect protection).
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : fallbackTarget;
  const formBase = card ? "card space-y-4 p-6" : "space-y-4";
  const inputBase = inputClassName ?? "input";
  const buttonBase = buttonClassName ?? "btn btn-primary w-full";

  return (
    <form className={`${formBase}${formClassName ? ` ${formClassName}` : ""}`} onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setError(null);
      const f = new FormData(e.currentTarget);
      try {
        await api(endpoint, { method: "POST", json: { email: String(f.get("email")), password: String(f.get("password")) } });
        router.replace(target);
        router.refresh();
      } catch (err) {
        setError(err instanceof ClientApiError ? err.message : "Giriş yapılamadı.");
      } finally { setBusy(false); }
    }}>
      <div><label htmlFor="email" className="mb-1 block text-sm font-medium">E-posta</label><input id="email" name="email" type="email" required autoComplete="username" placeholder={emailPlaceholder} className={inputBase} /></div>
      <div><label htmlFor="password" className="mb-1 block text-sm font-medium">Parola</label><input id="password" name="password" type="password" required autoComplete="current-password" placeholder={passwordPlaceholder} className={inputBase} /></div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button className={buttonBase} disabled={busy}>{busy ? "Giriş yapılıyor…" : submitLabel}</button>
    </form>
  );
}
