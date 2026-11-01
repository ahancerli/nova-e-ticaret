"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/components/cart/CartProvider";
import { api, ClientApiError, newIdempotencyKey } from "@/lib/api-client";
import { formatMinor } from "@/lib/money";
import type { Quote } from "@/lib/types";

const TERMS_VERSION = "2026-10-v1";

type ConfirmResult = { orderNumber: string; totalMinor: number; paymentMethod: "iyzico" | "bank_transfer"; payment: { paymentPageUrl: string | null } | null };

/** Guest checkout (no account required, spec R13). All amounts come from the server. */
export function CheckoutClient() {
  const { cart, refresh } = useCart();
  const [method, setMethod] = useState<"iyzico" | "bank_transfer">("iyzico");
  const [sameBilling, setSameBilling] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  if (cart.lines.length === 0) {
    return (
      <div className="container-page py-20 text-center">
        <h1 className="text-2xl font-bold">Sepetiniz boş</h1>
        <Link href="/" className="btn btn-primary mt-6">Alışverişe başla</Link>
      </div>
    );
  }

  const fe = (k: string) => fieldErrors[k]?.[0];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setFieldErrors({});
    // One key per submission: a network retry / double click of THIS request is replayed, not duplicated.
    const idemKey = newIdempotencyKey();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const addr = (p: string) => ({
      recipientName: s(`${p}name`), phone: s("phone"), province: s(`${p}province`), district: s(`${p}district`),
      line1: s(`${p}line1`), postalCode: s(`${p}postal`) || undefined,
    });
    try {
      const quote = await api<{ checkoutId: string; quote: Quote }>("/api/checkout/quote", { method: "POST", json: {} });
      if (quote.data.quote.totalMinor !== cart.totalMinor) {
        await refresh();
        setError(`Tutar güncellendi: ${formatMinor(quote.data.quote.totalMinor)}. Lütfen kontrol edip tekrar onaylayın.`);
        return;
      }
      const res = await api<ConfirmResult>("/api/checkout/confirm", {
        method: "POST",
        idempotencyKey: idemKey,
        json: {
          checkoutId: quote.data.checkoutId, paymentMethod: method, email: s("email"), phone: s("phone"),
          shipping: addr("s_"), billing: sameBilling ? undefined : addr("b_"), note: s("note") || undefined,
          acceptedTermsVersion: TERMS_VERSION,
        },
      });
      if (res.data.payment?.paymentPageUrl) {
        window.location.assign(res.data.payment.paymentPageUrl);
      } else {
        window.location.assign(`/siparis/sonuc?durum=havale&no=${encodeURIComponent(res.data.orderNumber)}`);
      }
    } catch (err) {
      if (err instanceof ClientApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
        if (["quote_changed", "cart_changed", "insufficient_stock", "checkout_expired"].includes(err.code)) {
          await refresh();
        }
      } else setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="container-page grid gap-6 py-8 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Ödeme</h1>
        <section className="card space-y-4 p-5" aria-labelledby="c-contact">
          <h2 id="c-contact" className="font-semibold">İletişim</h2>
          <p className="text-sm text-ink-soft">Üye olmadan devam edebilirsiniz. Sipariş bilgileri bu adrese gönderilir.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="email" label="E-posta" type="email" auto="email" err={fe("email")} />
            <Field name="phone" label="Cep telefonu (+905…)" type="tel" auto="tel" err={fe("phone")} />
          </div>
        </section>
        <section className="card space-y-4 p-5" aria-labelledby="c-ship">
          <h2 id="c-ship" className="font-semibold">Teslimat adresi</h2>
          <AddressFields p="s_" kind="shipping" fe={fe} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={sameBilling} onChange={(e) => setSameBilling(e.target.checked)} /> Fatura adresim aynı</label>
        </section>
        {!sameBilling && (
          <section className="card space-y-4 p-5" aria-labelledby="c-bill">
            <h2 id="c-bill" className="font-semibold">Fatura adresi</h2>
            <AddressFields p="b_" kind="billing" fe={fe} />
          </section>
        )}
        <section className="card space-y-3 p-5" aria-labelledby="c-pay">
          <h2 id="c-pay" className="font-semibold">Ödeme yöntemi</h2>
          {([["iyzico", "Kredi / banka kartı (iyzico)", "Güvenli ödeme sayfasına yönlendirilirsiniz."], ["bank_transfer", "Havale / EFT", "Siparişiniz, ödemeniz banka hesabımızda doğrulandıktan sonra hazırlanır."]] as const).map(([v, l, d]) => (
            <label key={v} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${method === v ? "border-brand bg-brand-soft" : "border-line"}`}>
              <input type="radio" name="method" value={v} checked={method === v} onChange={() => setMethod(v)} className="mt-1 accent-brand" />
              <span><span className="block font-medium">{l}</span><span className="text-sm text-ink-soft">{d}</span></span>
            </label>
          ))}
          <div>
            <label htmlFor="note" className="mb-1 block text-sm font-medium">Sipariş notu (isteğe bağlı)</label>
            <textarea id="note" name="note" maxLength={1000} rows={2} className="input min-h-20 py-2" />
          </div>
        </section>
      </div>

      <aside className="lg:sticky lg:top-28 lg:self-start">
        <div className="card p-5">
          <h2 className="mb-3 font-semibold">Sipariş özeti</h2>
          <ul className="mb-4 divide-y divide-line text-sm">
            {cart.lines.map((l) => (
              <li key={l.cartItemId} className="flex justify-between gap-3 py-2">
                <span className="min-w-0"><span className="line-clamp-1">{l.productName}</span><span className="text-xs text-muted">{l.quantity} adet {l.variantLabel && `· ${l.variantLabel}`}</span></span>
                <span className="tabular-nums">{formatMinor(l.totalMinor)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-ink-soft">Ara toplam</dt><dd>{formatMinor(cart.subtotalMinor)}</dd></div>
            {cart.discountMinor > 0 && <div className="flex justify-between text-success"><dt>İndirim</dt><dd>−{formatMinor(cart.discountMinor)}</dd></div>}
            <div className="flex justify-between"><dt className="text-ink-soft">Kargo</dt><dd>{cart.shippingMinor ? formatMinor(cart.shippingMinor) : "Ücretsiz"}</dd></div>
            <div className="flex justify-between text-xs text-muted"><dt>KDV dahil</dt><dd>{formatMinor(cart.taxMinor)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2 text-lg font-bold"><dt>Toplam</dt><dd className="text-brand">{formatMinor(cart.totalMinor)}</dd></div>
          </dl>
          <label className="mt-4 flex gap-2 text-xs text-ink-soft">
            <input type="checkbox" required className="mt-0.5 h-4 w-4 accent-brand" />
            <span><Link href="/sayfa/on-bilgilendirme" className="underline">Ön bilgilendirme formu</Link> ve <Link href="/sayfa/mesafeli-satis" className="underline">mesafeli satış sözleşmesini</Link> okudum, onaylıyorum.</span>
          </label>
          {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
          <button className="btn btn-primary mt-4 w-full" disabled={busy}>{busy ? "İşleniyor…" : "Siparişi onayla"}</button>
        </div>
      </aside>
    </form>
  );
}

function Field({ name, label, type = "text", auto, err }: { name: string; label: string; type?: string; auto?: string; err?: string }) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={name} name={name} type={type} required={name !== "s_postal" && name !== "b_postal"} autoComplete={auto} className="input"
        aria-invalid={!!err} aria-describedby={err ? `${name}-err` : undefined} />
      {err && <p id={`${name}-err`} className="mt-1 text-xs text-danger">{err}</p>}
    </div>
  );
}

function AddressFields({ p, kind, fe }: { p: string; kind: "shipping" | "billing"; fe: (k: string) => string | undefined }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name={`${p}name`} label="Ad soyad" auto={`${kind} name`} err={fe(`${kind}.recipientName`)} />
      <Field name={`${p}province`} label="İl" auto={`${kind} address-level1`} err={fe(`${kind}.province`)} />
      <Field name={`${p}district`} label="İlçe" auto={`${kind} address-level2`} err={fe(`${kind}.district`)} />
      <Field name={`${p}postal`} label="Posta kodu" auto={`${kind} postal-code`} err={fe(`${kind}.postalCode`)} />
      <div className="sm:col-span-2"><Field name={`${p}line1`} label="Adres" auto={`${kind} street-address`} err={fe(`${kind}.line1`)} /></div>
    </div>
  );
}
