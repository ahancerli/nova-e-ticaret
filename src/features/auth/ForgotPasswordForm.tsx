"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertCircle, ChevronLeft, MailCheck, Send } from "lucide-react";
import { errorMessage } from "@/lib/api-client";
import { authApi, type ForgotDevOutcome } from "./api";

const RESEND_AFTER_SEC = 60;
const DEV_TEXT: Record<Exclude<ForgotDevOutcome["outcome"], "failed">, string> = {
  sent: "E-posta SMTP sunucusuna teslim edildi. Gelmediyse spam klasörüne bakın; ayrıntı panelde Entegrasyonlar › E-posta › Son gönderimler'de.",
  skipped: "Bu adresle aktif bir panel (personel) hesabı yok — e-posta GÖNDERİLMEDİ. Panel hesabınızın e-posta adresini yazın; adresler Personel sayfasında.",
  throttled: "Bu adrese 2 dakika içinde zaten bağlantı gönderildi; yeni e-posta gönderilmedi. Biraz bekleyip tekrar deneyin.",
  not_configured: "SMTP ayarı yok — e-posta gönderilmedi. Bağlantı sunucu loguna yazıldı (yalnız geliştirme ortamında).",
};
const input = "h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#7367f0] focus:ring-4 focus:ring-[#7367f0]/15";

/**
 * "Parolamı unuttum" for the panel. The server answers the same for every address (no account enumeration), so
 * the confirmation is worded "if this address has an account…". Resend unlocks after a minute.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dev, setDev] = useState<ForgotDevOutcome | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async (address: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await authApi.forgotPassword(address.trim());
      setDev(r.data.dev ?? null);
      setSentTo(address.trim());
      setWait(RESEND_AFTER_SEC);
    } catch (err) {
      setError(errorMessage(err, "İstek gönderilemedi."));
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <Link href="/admin/giris" className="mt-6 flex items-center justify-center gap-1 text-sm font-medium text-[#7367f0] hover:text-[#5b4fe0]">
      <ChevronLeft className="size-4" /> Girişe dön
    </Link>
  );

  if (sentTo) {
    return (
      <div role="status" className="animate-scale-in">
        <span className="mb-5 grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><MailCheck className="size-7" /></span>
        <h1 className="text-2xl font-semibold text-slate-800">E-postanızı kontrol edin 📬</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          <b className="font-medium text-slate-700">{sentTo}</b> adresi bir panel hesabına aitse parola sıfırlama bağlantısı birkaç dakika içinde gelir.
          Bağlantı 24 saat geçerlidir ve tek kullanımlıktır. Gelen kutusunda yoksa istenmeyen (spam) klasörüne bakın.
        </p>
        {dev && (
          <div role="note" className={`mt-4 rounded-lg px-3.5 py-2.5 text-sm ring-1 ${dev.outcome === "sent" ? "bg-emerald-50 text-emerald-800 ring-emerald-100" : "bg-amber-50 text-amber-900 ring-amber-200"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-70">Geliştirme ortamı — gerçek sonuç (canlıda gösterilmez)</p>
            <p className="mt-1">{dev.outcome === "failed" ? <>E-posta gönderilemedi: {dev.message} <span className="font-mono text-xs">({dev.code})</span></> : DEV_TEXT[dev.outcome]}</p>
          </div>
        )}
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-100">{error}</p>}
        <button type="button" disabled={busy || wait > 0} onClick={() => send(sentTo)}
          className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
          <Send className="size-4" />{wait > 0 ? `Tekrar gönder (${wait} sn)` : busy ? "Gönderiliyor…" : "Tekrar gönder"}
        </button>
        <button type="button" onClick={() => { setSentTo(null); setError(null); setDev(null); }} className="mt-3 w-full text-sm text-slate-500 hover:text-slate-700">Başka bir adres yaz</button>
        {back}
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-800">Parolanızı mı unuttunuz? 🔒</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">Panel hesabınızın e-posta adresini yazın; parolanızı sıfırlamanız için size bir bağlantı gönderelim.</p>
      <form className="mt-7 space-y-5" noValidate onSubmit={(e) => { e.preventDefault(); if (!busy && email.trim()) void send(email); }}>
        {error && (
          <p role="alert" className="flex animate-shake items-start gap-2 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-red-100">
            <AlertCircle className="mt-0.5 size-4 flex-none" />{error}
          </p>
        )}
        <div>
          <label htmlFor="forgot-email" className="mb-1.5 block text-[13px] font-medium text-slate-700">E-posta</label>
          <input id="forgot-email" type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="E-posta adresinizi yazın" className={input} />
        </div>
        <button disabled={busy || !email.trim()}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#7367f0] text-sm font-semibold text-white shadow-md shadow-[#7367f0]/30 transition hover:bg-[#6559df] disabled:opacity-60">
          <Send className="size-4" />{busy ? "Gönderiliyor…" : "Sıfırlama bağlantısı gönder"}
        </button>
      </form>
      {back}
    </div>
  );
}
