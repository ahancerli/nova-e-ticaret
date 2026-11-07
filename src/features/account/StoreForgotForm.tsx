"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/api-client";
import { authApi } from "@/features/auth/api";

const RESEND_AFTER_SEC = 60;

/** "Şifremi unuttum" for customers. The answer never reveals whether the address has an account. */
export function StoreForgotForm() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async (address: string) => {
    setBusy(true); setError(null);
    try {
      await authApi.forgotCustomer(address.trim());
      setSentTo(address.trim());
      setWait(RESEND_AFTER_SEC);
    } catch (err) {
      setError(errorMessage(err, "İstek gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <div role="status" className="card space-y-3 p-6">
        <p className="text-3xl" aria-hidden>📬</p>
        <h2 className="text-lg font-bold">E-postanızı kontrol edin</h2>
        <p className="text-sm text-ink-soft"><strong>{sentTo}</strong> adresiyle bir üyelik varsa şifre yenileme bağlantısı birkaç dakika içinde gelir. Bağlantı 24 saat geçerlidir ve tek kullanımlıktır; gelen kutunuzda yoksa istenmeyen (spam) klasörüne bakın.</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="button" className="btn btn-ghost w-full" disabled={busy || wait > 0} onClick={() => send(sentTo)}>{wait > 0 ? `Tekrar gönder (${wait} sn)` : busy ? "Gönderiliyor…" : "Tekrar gönder"}</button>
        <button type="button" className="w-full text-sm text-ink-soft hover:text-brand" onClick={() => { setSentTo(null); setError(null); }}>Başka bir adres yaz</button>
      </div>
    );
  }
  return (
    <form className="card space-y-4 p-6" noValidate onSubmit={(e) => { e.preventDefault(); if (!busy && email.trim()) void send(email); }}>
      <p className="text-sm text-ink-soft">Üyeliğinizin e-posta adresini yazın; şifrenizi yenilemeniz için bir bağlantı gönderelim.</p>
      <div>
        <label htmlFor="forgot-email" className="mb-1 block text-sm font-medium">E-posta</label>
        <input id="forgot-email" type="email" required autoFocus autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button className="btn btn-primary w-full" disabled={busy || !email.trim()}>{busy ? "Gönderiliyor…" : "Yenileme bağlantısı gönder"}</button>
      <p className="text-center text-sm"><Link href="/giris" className="text-ink-soft hover:text-brand">← Girişe dön</Link></p>
    </form>
  );
}
