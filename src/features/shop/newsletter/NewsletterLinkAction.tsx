"use client";

import Link from "next/link";
import { useState } from "react";
import { MailCheck, MailX } from "lucide-react";
import { errorMessage } from "@/lib/api-client";
import { newsletterApi } from "../data/newsletter-api";

/**
 * The button behind an e-bülten e-mail link. The action runs on click (POST), never on page load, so mail scanners
 * that open links cannot confirm or unsubscribe for the reader.
 */
export function NewsletterLinkAction(props: { mode: "confirm"; token: string } | { mode: "unsubscribe"; id: string; sig: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = props.mode === "confirm";

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = props.mode === "confirm" ? await newsletterApi.confirm(props.token) : await newsletterApi.unsubscribe(props.id, props.sig);
      setDone(r.email);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const Icon = confirm ? MailCheck : MailX;
    return (
      <div role="status" className="text-center">
        <span className={`mx-auto grid size-16 place-items-center rounded-full ${confirm ? "bg-green-50 text-success" : "bg-ground text-ink-soft"}`}><Icon className="size-8" aria-hidden /></span>
        <h1 className="mt-5 font-display text-2xl font-extrabold tracking-tight">{confirm ? "Aboneliğiniz başladı" : "E-bültenden ayrıldınız"}</h1>
        <p className="mt-2 text-ink-soft">
          {confirm ? <><strong className="text-ink">{done}</strong> adresine kampanya ve yenilikleri göndereceğiz.</> : <><strong className="text-ink">{done}</strong> adresine artık e-bülten göndermeyeceğiz.</>}
        </p>
        <Link href="/" className="btn btn-primary mt-8">Alışverişe devam et</Link>
      </div>
    );
  }

  return (
    <div className="text-center">
      <h1 className="font-display text-2xl font-extrabold tracking-tight">{confirm ? "E-bülten kaydınızı onaylayın" : "E-bültenden ayrılmak istiyor musunuz?"}</h1>
      <p className="mt-2 text-ink-soft">
        {confirm ? "Onayladığınızda kampanya ve yeniliklerle ilgili e-postalarımızı almaya başlarsınız." : "Ayrıldığınızda size kampanya e-postası göndermeyiz. Sipariş ve kargo bildirimleri gelmeye devam eder."}
      </p>
      {error ? <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-danger">{error}</p> : null}
      <button type="button" onClick={run} disabled={busy} className={`btn mt-8 min-w-48 rounded-full ${confirm ? "btn-primary" : "border-2 border-ink bg-white text-ink hover:bg-ground"}`}>
        {busy ? "İşleniyor…" : confirm ? "Kaydımı onayla" : "E-bültenden ayrıl"}
      </button>
    </div>
  );
}
