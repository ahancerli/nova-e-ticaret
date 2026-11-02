import { hmacHex, randomToken, toBase64, type Database } from "@/core";
import type { SecretVault } from "@/modules/platform/secrets";
import type { CheckoutFormRequest, PaymentGateway } from "../application/ports";
import { PaymentErrors, fromProviderPrice, toProviderPrice, type CheckoutFormDetail } from "../domain/payment";

interface Credentials {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
}

const SANDBOX_URL = "https://sandbox-api.iyzipay.com";
const TIMEOUT_MS = 15_000;

/**
 * iyzico Checkout Form adapter (IYZWSv2 HMAC-SHA256 authorization). Credentials are the active iyzico
 * payment config's encrypted secrets (api_key, secret_key); base URL comes from its public config.
 *
 * ⚠ Verify request signing, field names and the webhook signature (X-IYZ-SIGNATURE-V3) against the
 *   current official docs before going live: https://docs.iyzico.com — they change over time.
 */
export class IyzicoGateway implements PaymentGateway {
  private creds: Promise<Credentials | null> | null = null;

  constructor(private readonly db: Database, private readonly vault: SecretVault) {}

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
      enabledInstallments: [1, 2, 3, 6, 9],
      buyer: {
        ...req.buyer,
        // TCKN: collecting it is a legal/business decision. Placeholder accepted by iyzico for non-invoice flows.
        identityNumber: "11111111111",
        country: "Turkey",
      },
      shippingAddress: { ...req.shippingAddress, country: "Turkey" },
      billingAddress: { ...req.billingAddress, country: "Turkey" },
      basketItems: req.basketItems.map(({ priceMinor, ...i }) => ({ ...i, price: toProviderPrice(priceMinor) })),
    });
    if (resp.status !== "success" || !resp.token) return { ok: false as const, error: resp.errorMessage ?? "init_failed" };
    return { ok: true as const, token: resp.token, paymentPageUrl: resp.paymentPageUrl ?? null };
  }

  checkoutFormDetail(token: string, conversationId: string | null): Promise<CheckoutFormDetail> {
    return this.call<CheckoutFormDetail>("/payment/iyzipos/checkoutform/auth/ecom/detail", { locale: "tr", conversationId: conversationId ?? undefined, token });
  }

  /** Payment-level refund (v2: paymentId + price), so partial amounts need no per-basket-item split. */
  async refund(r: { providerPaymentId: string; amountMinor: number; conversationId: string; ip: string }) {
    const resp = await this.call<{ status: string; paymentId?: string; price?: number | string; errorCode?: string }>("/v2/payment/refund", {
      locale: "tr", conversationId: r.conversationId, paymentId: r.providerPaymentId, price: toProviderPrice(r.amountMinor), currency: "TRY", ip: r.ip,
    });
    if (resp.status !== "success" || fromProviderPrice(resp.price) !== r.amountMinor) {
      return { ok: false as const, failureCode: resp.errorCode ?? (resp.status === "success" ? "amount_mismatch" : "refund_failed") };
    }
    return { ok: true as const, providerRefundId: resp.paymentId ?? null };
  }

  private credentials(): Promise<Credentials | null> {
    return (this.creds ??= (async () => {
      const cfg = await this.db.first<{ id: string; public_config_json: string }>(
        "SELECT id, public_config_json FROM payment_configs WHERE provider = 'iyzico' AND is_active = 1 LIMIT 1",
      );
      if (!cfg) return null;
      const [apiKey, secretKey] = await Promise.all([
        this.vault.read({ paymentConfigId: cfg.id }, "api_key"),
        this.vault.read({ paymentConfigId: cfg.id }, "secret_key"),
      ]);
      if (!apiKey || !secretKey) return null;
      let baseUrl = SANDBOX_URL;
      try {
        baseUrl = (JSON.parse(cfg.public_config_json || "{}") as { baseUrl?: string }).baseUrl ?? SANDBOX_URL;
      } catch { /* malformed public config → sandbox */ }
      return { apiKey, secretKey, baseUrl };
    })());
  }

  private async call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const creds = await this.credentials();
    if (!creds) throw PaymentErrors.misconfigured();
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
}
