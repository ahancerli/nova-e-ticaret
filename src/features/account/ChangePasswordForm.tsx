"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/api-client";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { passwordProblems } from "@/modules/identity/domain/password-policy";
import { authApi } from "@/features/auth/api";
import { PasswordField } from "@/features/auth/PasswordField";

/** Hesabım › Güvenlik: change the password (signs out every other device). */
export function ChangePasswordForm({ email, name }: { email: string; name: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = useFieldErrors();
  const ok = current.length > 0 && passwordProblems(next, { email, name }).length === 0;

  return (
    <form className="space-y-4" noValidate onSubmit={async (e) => {
      e.preventDefault();
      if (!ok || busy) return;
      setBusy(true); setError(null); errors.clear();
      try {
        await authApi.changePassword(current, next);
        setCurrent(""); setNext("");
        notify.success("Şifreniz değiştirildi", { description: "Diğer cihazlardaki oturumlarınız kapatıldı." });
      } catch (err) {
        if (!errors.fromError(err)) setError(errorMessage(err, "Şifre değiştirilemedi."));
      } finally {
        setBusy(false);
      }
    }}>
      <div>
        <label htmlFor="cur-pass" className="mb-1 block text-sm font-medium">Mevcut şifre</label>
        <input id="cur-pass" type="password" autoComplete="current-password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} aria-invalid={!!errors.get("currentPassword")} />
        {errors.get("currentPassword") && <p className="mt-1 text-xs text-danger">{errors.get("currentPassword")}</p>}
      </div>
      <PasswordField id="new-pass" label="Yeni şifre" value={next} onChange={setNext} context={{ email, name }} error={errors.get("newPassword")} tone="storefront" />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button className="btn btn-primary" disabled={!ok || busy}>{busy ? "Kaydediliyor…" : "Şifreyi değiştir"}</button>
    </form>
  );
}
