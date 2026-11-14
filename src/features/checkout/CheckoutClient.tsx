"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useCart } from "@/features/cart/CartProvider";
import { PromotionRows } from "@/features/cart/CartSummary";
import { ClientApiError, errorMessage, newIdempotencyKey } from "@/lib/api-client";
import { useFieldErrors } from "@/lib/use-field-errors";
import { checkoutApi } from "./api";
import { quoteItems, rememberPurchase } from "@/features/consent/commerce";
import { track } from "@/features/consent/track";
import { toAmount } from "@/modules/consent/domain/events";
import { formatMinor } from "@/lib/money";
import type { CheckoutLegal } from "@/modules/content";
import type { PaymentOptions } from "@/modules/payments";
import { PhoneField } from "@/features/geo/PhoneField";
import { RegionFields } from "@/features/geo/RegionFields";
import { BankAccounts } from "./BankAccounts";
import { CheckoutGate } from "./CheckoutGate";
import type { AddressView } from "@/modules/addresses";

export interface CheckoutCustomer {
  email: string;
  name: string;
}

const GUEST_KEY = "nova:checkout-guest";
const noSubscribe = () => () => {};
const readGuest = () => {
  try { return sessionStorage.getItem(GUEST_KEY) === "1"; } catch { return false; }
};

const METHODS = [
  { value: "iyzico", label: "Kredi / banka kartı (iyzico)", hint: "Güvenli ödeme sayfasına yönlendirilirsiniz." },
  { value: "bank_transfer", label: "Havale / EFT", hint: "Siparişiniz, ödemeniz banka hesabımızda doğrulandıktan sonra hazırlanır." },
] as const;

/**
 * Checkout. A visitor first chooses: sign in, continue as a guest (no account required, spec R13) or sign up; a
 * signed-in customer gets the form prefilled. All amounts come from the server; only enabled payment methods are offered.
 */
export function CheckoutClient({ legal, payment, customer, addresses = [] }: { legal: CheckoutLegal; payment: PaymentOptions; customer: CheckoutCustomer | null; addresses?: AddressView[] }) {
  // Saved address (Hesabım › Adreslerim) prefilled; picking another one re-mounts the fields with its values.
  const [pick, setPick] = useState<string | null>(addresses.find((a) => a.isDefaultShipping)?.id ?? addresses[0]?.id ?? null);
  const picked = addresses.find((a) => a.id === pick) ?? null;
  const { cart, refresh } = useCart();
  const router = useRouter();
  const methods = METHODS.filter((m) => (m.value === "iyzico" ? payment.card : payment.bankTransfer));
  const [method, setMethod] = useState<"iyzico" | "bank_transfer">(methods[0]?.value ?? "iyzico");
  const [sameBilling, setSameBilling] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = useFieldErrors();
  // the guest choice survives a reload of the payment step (per tab); the server renders the choice screen
  const storedGuest = useSyncExternalStore(noSubscribe, readGuest, () => false);
  const [chosen, setGuest] = useState<boolean | null>(null);
  const guest = chosen ?? storedGuest;
  // begin_checkout once per visit of the payment step, as soon as the cart has loaded
  const checkoutTracked = useRef(false);
  useEffect(() => {
    if (checkoutTracked.current || cart.lines.length === 0) return;
    checkoutTracked.current = true;
    track({ name: "begin_checkout", items: quoteItems(cart), value: toAmount(cart.totalMinor), coupon: cart.couponCode });
  }, [cart]);

  if (cart.lines.length === 0 && !busy) {
    return (
      <div className="container-page py-20 text-center">
        <h1 className="text-2xl font-bold">Sepetiniz boş</h1>
        <Link href="/" className="btn btn-primary mt-6">Alışverişe başla</Link>
      </div>
    );
  }

  if (!customer && !guest) {
    return <CheckoutGate itemCount={cart.itemCount} onGuest={() => { setGuest(true); try { sessionStorage.setItem(GUEST_KEY, "1"); } catch { /* ignore */ } }} />;
  }

  const fe = errors.get;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); errors.clear();
    // One key per submission: a network retry / double click of THIS request is replayed, not duplicated.
    const idemKey = newIdempotencyKey();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const addr = (p: string) => ({
      recipientName: s(`${p}name`), phone: s("phone"), countryCode: s(`${p}country`) || undefined, province: s(`${p}province`), district: s(`${p}district`),
      line1: s(`${p}line1`), postalCode: s(`${p}postal`) || undefined,
    });
    try {
      const quote = await checkoutApi.quote();
      if (quote.data.quote.totalMinor !== cart.totalMinor) {
        await refresh();
        setError(`Tutar güncellendi: ${formatMinor(quote.data.quote.totalMinor)}. Lütfen kontrol edip tekrar onaylayın.`);
        return;
      }
      const res = await checkoutApi.confirm({
        checkoutId: quote.data.checkoutId, paymentMethod: method, email: s("email"), phone: s("phone"), phoneCountry: s("phoneCountry") || undefined,
        shipping: addr("s_"), billing: sameBilling ? undefined : addr("b_"), note: s("note") || undefined,
        acceptedTermsVersion: legal.termsVersion,
      }, idemKey);
      // The server converted the cart in the same transaction as the order: show the empty cart before leaving
      // (the provider lives in the layout and would otherwise keep the old lines until a full reload).
      try { sessionStorage.removeItem(GUEST_KEY); } catch { /* ignore */ }
      rememberPurchase(res.data.orderNumber, quote.data.quote);
      await refresh().catch(() => undefined);
      if (res.data.payment?.paymentPageUrl) {
        window.location.assign(res.data.payment.paymentPageUrl);
      } else {
        router.push(`/siparis/sonuc?durum=havale&no=${encodeURIComponent(res.data.orderNumber)}`);
      }
    } catch (err) {
      setError(errorMessage(err));
      errors.fromError(err);
      if (err instanceof ClientApiError && ["quote_changed", "cart_changed", "insufficient_stock", "checkout_expired"].includes(err.code)) {
        await refresh();
      }
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
          {customer ? (
            <p className="text-sm text-ink-soft"><strong className="text-ink">{customer.name}</strong> olarak giriş yaptınız; sipariş hesabınızda görünecek.</p>
          ) : (
            <p className="flex flex-wrap items-center gap-x-3 text-sm text-ink-soft">Misafir olarak devam ediyorsunuz. Sipariş bilgileri bu adrese gönderilir.
              <button type="button" className="font-semibold text-brand hover:underline" onClick={() => { setGuest(false); try { sessionStorage.removeItem(GUEST_KEY); } catch { /* ignore */ } }}>Giriş yap / üye ol</button>
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="email" label="E-posta" type="email" auto="email" err={fe("email")} defaultValue={customer?.email} readOnly={!!customer} />
            <PhoneField key={`phone-${pick ?? "new"}`} id="phone" name="phone" label="Cep telefonu" required error={fe("phone")} defaultValue={picked?.phone} defaultCountry={picked?.countryCode} />
          </div>
        </section>
        <section className="card space-y-4 p-5" aria-labelledby="c-ship">
          <h2 id="c-ship" className="font-semibold">Teslimat adresi</h2>
          {addresses.length > 0 && (
            <div role="radiogroup" aria-label="Kayıtlı adreslerim" className="flex flex-wrap gap-2">
              {[...addresses.map((a) => ({ id: a.id as string | null, label: a.label, sub: `${a.district} / ${a.province}` })), { id: null, label: "Yeni adres", sub: "Elle gir" }].map((o) => (
                <button key={o.id ?? "new"} type="button" role="radio" aria-checked={pick === o.id} onClick={() => setPick(o.id)}
                  className={`rounded-2xl border-2 px-3.5 py-2 text-left text-sm transition ${pick === o.id ? "border-ink bg-ink text-white" : "border-line hover:border-ink"}`}>
                  <span className="block font-semibold">{o.label}</span><span className="block text-xs opacity-75">{o.sub}</span>
                </button>
              ))}
            </div>
          )}
          <AddressFields key={pick ?? "new"} p="s_" kind="shipping" fe={fe} name={customer?.name} saved={picked} />
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
          {methods.length === 0 && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">Şu an çevrim içi ödeme alınamıyor. Lütfen daha sonra tekrar deneyin veya bizimle iletişime geçin.</p>
          )}
          {methods.map(({ value: v, label: l, hint: d }) => (
            <label key={v} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${method === v ? "border-brand bg-brand-soft" : "border-line"}`}>
              <input type="radio" name="method" value={v} checked={method === v} onChange={() => setMethod(v)} className="mt-1 accent-brand" />
              <span><span className="block font-medium">{l}</span><span className="text-sm text-ink-soft">{d}</span></span>
            </label>
          ))}
          {method === "bank_transfer" && payment.bankTransfer && (
            <div className="space-y-2">
              <p className="text-sm text-ink-soft">Siparişi onayladıktan sonra tutarı aşağıdaki hesaba gönderin; açıklamaya sipariş numaranızı yazın.</p>
              <BankAccounts accounts={payment.bankAccounts} />
            </div>
          )}
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
            <PromotionRows cart={cart} />
            <div className="flex justify-between"><dt className="text-ink-soft">Kargo</dt><dd>{cart.shippingMinor ? formatMinor(cart.shippingMinor) : "Ücretsiz"}</dd></div>
            <div className="flex justify-between text-xs text-muted"><dt>KDV dahil</dt><dd>{formatMinor(cart.taxMinor)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2 text-lg font-bold"><dt>Toplam</dt><dd className="text-brand">{formatMinor(cart.totalMinor)}</dd></div>
          </dl>
          <label className="mt-4 flex gap-2 text-xs text-ink-soft">
            <input type="checkbox" required className="mt-0.5 h-4 w-4 accent-brand" />
            {/* Documents open in a new tab so the filled form is kept; versions go with the order (user_consents). */}
            <span>
              <LegalLink doc={legal.preInformation}>Ön bilgilendirme formu</LegalLink> ve <LegalLink doc={legal.distanceSales}>mesafeli satış sözleşmesini</LegalLink> okudum, onaylıyorum.
            </span>
          </label>
          {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
          <button className="btn btn-primary mt-4 w-full" disabled={busy || methods.length === 0}>{busy ? "İşleniyor…" : "Siparişi onayla"}</button>
        </div>
      </aside>
    </form>
  );
}

function Field({ name, label, type = "text", auto, err, defaultValue, readOnly }: { name: string; label: string; type?: string; auto?: string; err?: string; defaultValue?: string; readOnly?: boolean }) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={name} name={name} type={type} required={name !== "s_postal" && name !== "b_postal"} autoComplete={auto} className={`input${readOnly ? " bg-ground text-ink-soft" : ""}`}
        defaultValue={defaultValue} readOnly={readOnly}
        aria-invalid={!!err} aria-describedby={err ? `${name}-err` : undefined} />
      {err && <p id={`${name}-err`} className="mt-1 text-xs text-danger">{err}</p>}
    </div>
  );
}

function AddressFields({ p, kind, fe, name, saved }: { p: string; kind: "shipping" | "billing"; fe: (k: string) => string | undefined; name?: string; saved?: AddressView | null }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <RegionFields id={`${p}region`} name={p} autoSection={kind} defaultValue={saved}
        errors={{ countryCode: fe(`${kind}.countryCode`), province: fe(`${kind}.province`), district: fe(`${kind}.district`) }} />
      <Field name={`${p}name`} label="Ad soyad" auto={`${kind} name`} err={fe(`${kind}.recipientName`)} defaultValue={saved?.recipientName ?? name} />
      <Field name={`${p}postal`} label="Posta kodu" auto={`${kind} postal-code`} err={fe(`${kind}.postalCode`)} defaultValue={saved?.postalCode ?? undefined} />
      <div className="sm:col-span-2"><Field name={`${p}line1`} label="Adres" auto={`${kind} street-address`} err={fe(`${kind}.line1`)} defaultValue={saved ? [saved.line1, saved.line2].filter(Boolean).join(", ") : undefined} /></div>
    </div>
  );
}

function LegalLink({ doc, children }: { doc: CheckoutLegal["distanceSales"]; children: React.ReactNode }) {
  if (!doc) return <>{children}</>;
  return <Link href={doc.href} target="_blank" rel="noopener" className="underline">{children}</Link>;
}
