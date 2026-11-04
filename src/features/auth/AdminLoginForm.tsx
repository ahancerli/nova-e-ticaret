"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { AlertCircle, Eye, EyeOff, LogIn } from "lucide-react";
import { errorMessage } from "@/lib/api-client";
import { safeInternalPath } from "@/lib/safe-redirect";
import { authApi } from "./api";

const input = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#7367f0] focus:ring-4 focus:ring-[#7367f0]/15";

/** Panel sign-in: e-mail, password (show / hide), "Beni hatırla" (7-day session) and "Parolamı unuttum?". */
export function AdminLoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const target = safeInternalPath(params.get("next"), "/admin");
  // Prefilled after setting a password from an invitation / reset link.
  const prefillEmail = params.get("email")?.slice(0, 254) ?? undefined;
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form className="space-y-5" noValidate onSubmit={async (e) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      const f = new FormData(e.currentTarget);
      try {
        await authApi.login("admin", { email: String(f.get("email")), password: String(f.get("password")), remember: f.get("remember") === "on" });
        router.replace(target);
        router.refresh();
      } catch (err) {
        setError(errorMessage(err, "Giriş yapılamadı."));
        setBusy(false);
      }
    }}>
      {prefillEmail && !error && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700 ring-1 ring-emerald-100">Parolanız kaydedildi. Yeni parolanızla giriş yapın.</p>
      )}
      {error && (
        <p role="alert" className="flex animate-shake items-start gap-2 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-100">
          <AlertCircle className="mt-0.5 size-4 flex-none" />{error}
        </p>
      )}
      <div>
        <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-slate-700">E-posta</label>
        <input id="email" name="email" type="email" required autoComplete="username" autoFocus={!prefillEmail} defaultValue={prefillEmail}
          placeholder="E-posta adresinizi yazın" className={input} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-slate-700">Parola</label>
        <div className="relative">
          <input id="password" name="password" type={visible ? "text" : "password"} required autoComplete="current-password" autoFocus={!!prefillEmail}
            placeholder="············" className={`${input} pr-11`} />
          <button type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? "Parolayı gizle" : "Parolayı göster"}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 transition hover:text-slate-700">
            {visible ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <label className="inline-flex cursor-pointer items-center gap-2 text-slate-600">
          <input type="checkbox" name="remember" className="size-[18px] rounded border-slate-300 accent-[#7367f0]" />
          Beni hatırla
        </label>
        <Link href="/admin/sifremi-unuttum" className="font-medium text-[#7367f0] hover:text-[#5b4fe0] hover:underline">Parolamı unuttum?</Link>
      </div>
      <button disabled={busy}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#7367f0] text-sm font-semibold text-white shadow-md shadow-[#7367f0]/30 transition hover:bg-[#6559df] active:scale-[0.99] disabled:opacity-60">
        <LogIn className="size-4" />{busy ? "Giriş yapılıyor…" : "Giriş yap"}
      </button>
    </form>
  );
}
