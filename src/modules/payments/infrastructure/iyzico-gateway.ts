import { hmacHex, randomToken, toBase64, type Database, type Logger } from "@/core";
import type { SecretVault } from "@/modules/platform/secrets";
import type { CheckoutFormRequest, PaymentGateway, ProviderInstallmentDetail, ProviderItemTransaction } from "../application/ports";
import {
  ENABLED_INSTALLMENTS, checkoutFormSignatureData, paymentDetailSignatureData, refundSignatureData, sameHex, webhookSignatureMessage, type IyzicoWebhookBody,
} from "../domain/iyzico";
import type { IyzicoProbe } from "../application/settings-ports";
import { PaymentErrors, fromProviderPrice, toProviderPrice, type CheckoutFormDetail } from "../domain/payment";
import { IYZICO_BASE_URL, IYZICO_SECRET_NAMES, type IyzicoEnvironment } from "../domain/payment-settings";

interface Credentials {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
}

const TIMEOUT_MS = 15_000;

/** One signed (IYZWSv2) POST. Throws `providerUnreachable` on network errors and non-2xx responses. */
async function iyzicoCall<T>(creds: Credentials, path: string, body: Record<string, unknown>): Promise<T> {
  const json = JSON.stringify(body);
  const randomKey = `${Date.now()}${randomToken(6)}`;
  const signature = await hmacHex(creds.secretKey, randomKey + path + json);
  const auth = toBase64(new TextEncoder().encode(`apiKey:${creds.apiKey}&randomKey:${randomKey}&signature:${signature}`));
  let res: Response;
  try {
    res = await fetch(creds.baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `IYZWSv2 ${auth}`, "x-iyzi-rnd": randomKey },
      body: json,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw Object.assign(PaymentErrors.providerUnreachable(), { cause: err });
  }
  if (!res.ok) throw PaymentErrors.providerUnreachable();
  return (await res.json()) as T;
}

/**
 * iyzico Checkout Form adapter (IYZWSv2 HMAC-SHA256 authorization). Credentials are the active iyzico
 * payment config's encrypted secrets (api_key, secret_key); base URL follows its environment (sandbox / production).
 * Checked against docs.iyzico.com on 2026-11-16: authentication, Checkout Form initialize / retrieve, response
 * signatures, Refund V1 (per basket item — V2 is "strictly not recommended" for baskets with several products),
 * installment inquiry, webhook X-IYZ-SIGNATURE-V3. Still run `npm run iyzico:sandbox` with sandbox keys before going live.
 */
export class IyzicoGateway implements PaymentGateway {
  private creds: Promise<Credentials | null> | null = null;

  constructor(private readonly db: Database, private readonly vault: SecretVault, private readonly logger?: Logger) {}

  async isAvailable(): Promise<boolean> {
    return (await this.credentials()) !== null;
  }

  async initializeCheckoutForm(req: CheckoutFormRequest) {
    const resp = await this.call<{ status: string; token?: string; paymentPageUrl?: string; errorMessage?: string }>("/payment/iyzipos/checkoutform/initialize/auth/ecom", {
      locale: "tr",
      conversationId: req.conversationId,
      price: toProviderPrice(req.amountMinor),
      paidPrice: toProviderPrice(req.amountMinor),
      currency: "TRY",
      basketId: req.basketId,
      paymentGroup: "PRODUCT",
      callbackUrl: req.callbackUrl,
      enabledInstallments: [...ENABLED_INSTALLMENTS],
      buyer: {
        ...req.buyer,
        // TCKN: collecting it is a legal/business decision. Placeholder accepted by iyzico for non-invoice flows.
        identityNumber: "11111111111",
      },
      shippingAddress: req.shippingAddress,
      billingAddress: req.billingAddress,
      basketItems: req.basketItems.map(({ priceMinor, ...i }) => ({ ...i, price: toProviderPrice(priceMinor) })),
    });
    if (resp.status !== "success" || !resp.token) return { ok: false as const, error: resp.errorMessage ?? "init_failed" };
    return { ok: true as const, token: resp.token, paymentPageUrl: resp.paymentPageUrl ?? null };
  }

  async checkoutFormDetail(token: string, conversationId: string | null): Promise<CheckoutFormDetail> {
    const d = await this.call<CheckoutFormDetail>("/payment/iyzipos/checkoutform/auth/ecom/detail", { locale: "tr", conversationId: conversationId ?? undefined, token });
    const signatureValid = await this.verify(d.signature, checkoutFormSignatureData({ ...d, token: d.token ?? token }));
    if (signatureValid === false) this.logger?.error("iyzico checkout form signature mismatch", { basketId: d.basketId ?? null });
    return { ...d, signatureValid, itemTransactions: d.itemTransactions?.map((t) => ({ ...t, paymentTransactionId: String(t.paymentTransactionId) })) };
  }

  /** Retrieve payment (/payment/detail): the basket item transactions of a payment settled before they were stored. */
  async paymentItems(providerPaymentId: string): Promise<ProviderItemTransaction[] | null> {
    const d = await this.call<{ status: string; signature?: string; paymentId?: string; currency?: string; basketId?: string; conversationId?: string; paidPrice?: number | string; price?: number | string;
      itemTransactions?: { itemId: string; paymentTransactionId: string | number; price?: number | string; paidPrice?: number | string }[] }>("/payment/detail", { locale: "tr", paymentId: providerPaymentId });
    if (d.status !== "success" || (await this.verify(d.signature, paymentDetailSignatureData(d))) === false) return null;
    return (d.itemTransactions ?? []).map((t) => ({ itemId: t.itemId, paymentTransactionId: String(t.paymentTransactionId), priceMinor: fromProviderPrice(t.price), paidPriceMinor: fromProviderPrice(t.paidPrice ?? t.price) }));
  }

  /**
   * Refund V1: one basket item transaction, `price` ≤ that item's price. Network / non-2xx errors throw (the outbox
   * retries); an iyzico "failure" answer is final.
   */
  async refundItem(r: { paymentTransactionId: string; amountMinor: number; conversationId: string; ip: string }) {
    const resp = await this.call<{ status: string; paymentId?: string | number; paymentTransactionId?: string | number; price?: number | string; currency?: string; conversationId?: string;
      errorCode?: string; signature?: string; refundHostReference?: string; hostReference?: string }>("/payment/refund", {
      locale: "tr", conversationId: r.conversationId, paymentTransactionId: r.paymentTransactionId, price: toProviderPrice(r.amountMinor), currency: "TRY", ip: r.ip,
    });
    if (resp.status !== "success") return { ok: false as const, failureCode: resp.errorCode ?? "refund_failed" };
    // The money is back on the card once iyzico says success; a signature / amount mismatch is logged for staff,
    // never answered with a second refund.
    if ((await this.verify(resp.signature, refundSignatureData(resp))) === false || fromProviderPrice(resp.price) !== r.amountMinor) {
      this.logger?.error("iyzico refund response mismatch", { paymentTransactionId: r.paymentTransactionId, price: String(resp.price ?? "") });
    }
    return { ok: true as const, providerRef: resp.refundHostReference ?? resp.hostReference ?? null };
  }

  /** Installment inquiry without a BIN: every card family's options for this amount (null = not configured / refused). */
  async installments(priceMinor: number): Promise<ProviderInstallmentDetail[] | null> {
    if (!(await this.credentials())) return null;
    const d = await this.call<{ status: string; installmentDetails?: {
      cardFamilyName?: string; bankName?: string; cardType?: string; cardAssociation?: string; commercial?: number;
      installmentPrices?: { installmentNumber: number; installmentPrice: number | string; totalPrice: number | string }[];
    }[] }>("/payment/iyzipos/installment", { locale: "tr", conversationId: `installment-${priceMinor}`, price: toProviderPrice(priceMinor) });
    if (d.status !== "success") return null;
    return (d.installmentDetails ?? []).map((x) => ({
      cardFamily: x.cardFamilyName ?? null, bankName: x.bankName ?? null, commercial: x.commercial === 1,
      prices: (x.installmentPrices ?? []).map((p) => ({ count: Number(p.installmentNumber), monthlyMinor: fromProviderPrice(p.installmentPrice), totalMinor: fromProviderPrice(p.totalPrice) })),
    }));
  }

  /** X-IYZ-SIGNATURE-V3 of a webhook. null = card payments not configured (cannot check). */
  async webhookSignatureValid(body: IyzicoWebhookBody, header: string): Promise<boolean | null> {
    const creds = await this.credentials();
    if (!creds) return null;
    return sameHex(await hmacHex(creds.secretKey, webhookSignatureMessage(creds.secretKey, body)), header);
  }

  /** Response signature check: null when iyzico sent none. */
  private async verify(signature: string | undefined, data: string): Promise<boolean | null> {
    if (!signature) return null;
    const creds = await this.credentials();
    return creds ? sameHex(await hmacHex(creds.secretKey, data), signature) : null;
  }

  private credentials(): Promise<Credentials | null> {
    return (this.creds ??= (async () => {
      const cfg = await this.db.first<{ id: string; environment: IyzicoEnvironment }>(
        "SELECT id, environment FROM payment_configs WHERE provider = 'iyzico' AND is_active = 1 LIMIT 1",
      );
      if (!cfg) return null;
      const [apiKey, secretKey] = await Promise.all([
        this.vault.read({ paymentConfigId: cfg.id }, IYZICO_SECRET_NAMES.apiKey),
        this.vault.read({ paymentConfigId: cfg.id }, IYZICO_SECRET_NAMES.secretKey),
      ]);
      if (!apiKey || !secretKey) return null;
      return { apiKey, secretKey, baseUrl: IYZICO_BASE_URL[cfg.environment] ?? IYZICO_BASE_URL.sandbox };
    })());
  }

  private async call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const creds = await this.credentials();
    if (!creds) throw PaymentErrors.misconfigured();
    return iyzicoCall<T>(creds, path, body);
  }
}

/** Key check through the BIN lookup: signed like a payment call, but read-only (no payment, no charge). */
export { iyzicoCall };
export class IyzicoBinProbe implements IyzicoProbe {
  async check(creds: Credentials) {
    try {
      const r = await iyzicoCall<{ status: string; errorMessage?: string }>(creds, "/payment/bin/check", { locale: "tr", binNumber: "554960" });
      return r.status === "success" ? { ok: true as const } : { ok: false as const, message: r.errorMessage ?? "anahtarlar reddedildi" };
    } catch {
      return { ok: false as const, message: "iyzico'ya ulaşılamadı" };
    }
  }
}
