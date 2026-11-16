import { sha256Hex, type Clock, type Database, type IdGenerator, type Logger } from "@/core";
import type { SettleOptions, SettleResult } from "@/modules/checkout";
import { planRefundParts } from "../domain/iyzico";
import { PaymentErrors, TOKEN_PATTERN, detailMatchesPayment, fromProviderPrice } from "../domain/payment";
import type { Address, CheckoutFormRequest, PaymentGateway, PaymentRepository } from "./ports";

/** Payment settlement (checkout's SettlePayment) as seen from here. */
export interface PaymentSettlement {
  settle(paymentId: string, opts: SettleOptions): Promise<SettleResult>;
}

/** Refund finalisation (orders' SettleRefund) as seen from here. */
export interface RefundFinaliser {
  settle(refundId: string, r: { ok: boolean; providerRefundId?: string | null; failureCode?: string | null }): Promise<unknown>;
}

const addressLine = (a: Address) => [a.line1, a.line2, a.district].filter(Boolean).join(", ");
// iyzico expects the country as an English name ("Turkey", "Germany").
const englishCountry = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (code: string) => (code === "TR" ? "Turkey" : englishCountry.of(code) ?? code);
const toProviderAddress = (a: Address) => ({ contactName: a.recipientName, city: a.province, country: countryName(a.countryCode), address: addressLine(a), zipCode: a.postalCode ?? undefined });

/**
 * Command: starts the hosted card form for a pending card payment (after the order transaction committed).
 * The browser's later "success" redirect is never proof of payment — see VerifyCardPayment.
 */
export class StartCardPayment {
  constructor(private readonly payments: PaymentRepository, private readonly gateway: PaymentGateway, private readonly clock: Clock, private readonly publicSiteUrl: string) {}

  async execute(paymentId: string, buyerIp: string): Promise<{ paymentPageUrl: string | null; token: string }> {
    if (!(await this.gateway.isAvailable())) throw PaymentErrors.cardUnavailable();
    const p = await this.payments.cardPaymentToStart(paymentId);
    if (!p) throw PaymentErrors.notFound();
    if (p.status !== "pending" && p.status !== "created") throw PaymentErrors.notPending();

    const [name, ...rest] = p.shipping.recipientName.trim().split(/\s+/);
    const basketItems: CheckoutFormRequest["basketItems"] = p.items
      .filter((i) => i.totalMinor > 0)
      .map((i) => ({ id: i.id, name: i.name.slice(0, 100), category1: "Genel", itemType: "PHYSICAL", priceMinor: i.totalMinor }));
    if (p.shippingMinor > 0) basketItems.push({ id: "shipping", name: "Kargo", category1: "Kargo", itemType: "VIRTUAL", priceMinor: p.shippingMinor });

    const res = await this.gateway.initializeCheckoutForm({
      conversationId: p.conversationId,
      amountMinor: p.amountMinor,
      basketId: p.orderNumber,
      callbackUrl: `${this.publicSiteUrl}/api/payments/iyzico/callback`,
      buyer: {
        id: p.userId ?? `guest-${p.orderId}`, name: name ?? "Müşteri", surname: rest.join(" ") || "-", gsmNumber: p.customerPhone ?? undefined,
        email: p.customerEmail, ip: buyerIp, city: p.billing.province, country: countryName(p.billing.countryCode), registrationAddress: addressLine(p.billing),
      },
      shippingAddress: toProviderAddress(p.shipping),
      billingAddress: toProviderAddress(p.billing),
      basketItems,
    });
    const now = this.clock.nowIso();
    if (!res.ok) {
      await this.payments.markInitFailed(p.paymentId, now);
      throw PaymentErrors.initFailed();
    }
    await this.payments.recordCheckoutToken(p.paymentId, res.token, now);
    return { paymentPageUrl: res.paymentPageUrl, token: res.token };
  }
}

export type VerifyResult = { status: "paid" | "failed" | "unknown"; orderNumber: string | null };

/**
 * Command: verifies a checkout-form token with the provider's authenticated detail API (never trusting the
 * callback / webhook payload) and settles the payment when everything matches. Safe to call repeatedly:
 * provider events are de-duplicated and settlement is idempotent; a late payment is recorded, not lost.
 */
export class VerifyCardPayment {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly gateway: PaymentGateway,
    private readonly settlement: PaymentSettlement,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly logger: Logger,
  ) {}

  async execute(token: string, source: "callback" | "webhook", eventId?: string, signatureValid = false): Promise<VerifyResult> {
    if (!TOKEN_PATTERN.test(token)) return { status: "unknown", orderNumber: null };
    const pay = await this.payments.byToken(token);
    const detail = await this.gateway.checkoutFormDetail(token, pay?.conversationId ?? null);

    if (!pay) {
      // Already settled (token replaced by iyzico's payment id) → the repeated callback still lands on "paid".
      const settled = detail.basketId ? await this.payments.paidCardPaymentOfOrder(detail.basketId) : null;
      return settled ? { status: "paid", orderNumber: settled.orderNumber } : { status: "unknown", orderNumber: null };
    }

    const providerEventId = eventId ?? `${source}:${detail.paymentId ?? token}`;
    const fresh = await this.payments.recordEvent({
      id: this.ids.newId(), paymentId: pay.id, providerEventId, eventType: `checkoutform.${source}`, payloadSha256: await sha256Hex(JSON.stringify(detail)), signatureValid,
    });
    if (!fresh && pay.status === "paid") return { status: "paid", orderNumber: pay.orderNumber };

    const now = this.clock.nowIso();
    if (!detailMatchesPayment(detail, pay)) {
      await this.payments.markVerificationFailed(pay.id, detail.paymentStatus ?? "verification_failed", now);
      await this.payments.markEvent(providerEventId, "failed", now);
      this.logger.warn("card payment verification failed", { paymentId: pay.id, source, providerStatus: detail.paymentStatus ?? detail.status });
      return { status: "failed", orderNumber: pay.orderNumber };
    }

    // iyzico refunds per basket item (Refund V1): keep each item's transaction id with the settlement.
    const items = (detail.itemTransactions ?? []).map((t) => ({
      itemId: t.itemId, paymentTransactionId: t.paymentTransactionId, priceMinor: fromProviderPrice(t.price), paidPriceMinor: fromProviderPrice(t.paidPrice ?? t.price),
    }));
    await this.settlement.settle(pay.id, { providerPaymentId: detail.paymentId ?? null, allowLate: true, extra: this.payments.itemTransactionStatements(pay.id, items) });
    await this.payments.markEvent(providerEventId, "processed", now);
    return { status: "paid", orderNumber: pay.orderNumber };
  }
}

/**
 * Outbox command "refund.process": pays a card refund back through iyzico Refund V1 — split over the basket item
 * transactions (the cancelled items first, shipping last), one call per item. Each answered part is recorded, so a
 * retry after a network error / provider outage (the call throws → the outbox retries) never refunds a part twice.
 * Finalised as succeeded when every part went through; a final iyzico refusal fails the refund (staff sees the
 * code; parts already paid back stay recorded). Payments settled before item transactions were stored fetch them
 * once from /payment/detail.
 */
export class ProcessCardRefund {
  constructor(
    private readonly payments: PaymentRepository, private readonly gateway: PaymentGateway, private readonly refunds: RefundFinaliser,
    private readonly ids: IdGenerator, private readonly db: Database,
  ) {}

  async execute(refundId: string): Promise<string> {
    const r = await this.payments.refundToProcess(refundId);
    if (!r) return "refund_missing";
    if (!["requested", "processing"].includes(r.status)) return `already_${r.status}`;
    if (r.provider !== "iyzico" || !r.providerPaymentId || r.providerPaymentId.startsWith("token:")) {
      await this.refunds.settle(refundId, { ok: false, failureCode: "no_provider_payment_id" });
      return "failed_no_payment_id";
    }

    let items = await this.payments.itemTransactions(r.paymentId);
    if (!items.length) {
      const fetched = await this.gateway.paymentItems(r.providerPaymentId);
      if (fetched?.length) {
        await this.db.batch(this.payments.itemTransactionStatements(r.paymentId, fetched));
        items = await this.payments.itemTransactions(r.paymentId);
      }
    }
    if (!items.length) {
      await this.refunds.settle(refundId, { ok: false, failureCode: "no_item_transactions" });
      return "failed_no_item_transactions";
    }

    const done = (await this.payments.refundParts(refundId)).filter((p) => p.status === "succeeded");
    const left = r.amountMinor - done.reduce((a, p) => a + p.amountMinor, 0);
    const plan = left > 0 ? planRefundParts(left, items, await this.payments.refundItemIds(refundId)) : [];
    if (!plan) {
      await this.refunds.settle(refundId, { ok: false, failureCode: done.length ? "partial_exceeds_items" : "exceeds_items" });
      return "failed_exceeds_items";
    }
    const refs: string[] = [];
    let sent = r.amountMinor - left;
    for (const part of plan) {
      const res = await this.gateway.refundItem({ paymentTransactionId: part.paymentTransactionId, amountMinor: part.amountMinor, conversationId: `refund-${refundId}-${part.itemId}`.slice(0, 64), ip: "127.0.0.1" });
      await this.payments.recordRefundPart({
        id: this.ids.newId(), refundId, paymentTransactionId: part.paymentTransactionId, amountMinor: part.amountMinor, status: res.ok ? "succeeded" : "failed",
        providerRef: res.ok ? res.providerRef : null, failureCode: res.ok ? null : res.failureCode,
      });
      if (!res.ok) {
        // "partial:<kuruş paid back>:<code>" = items already refunded before iyzico refused this one (see refund_parts);
        // a later refund never takes those items again (planRefundParts counts succeeded parts).
        await this.refunds.settle(refundId, { ok: false, failureCode: sent > 0 ? `partial:${sent}:${res.failureCode}` : res.failureCode });
        return res.failureCode;
      }
      sent += part.amountMinor;
      refs.push(res.providerRef ?? part.paymentTransactionId);
    }
    await this.refunds.settle(refundId, { ok: true, providerRefundId: refs.join(",").slice(0, 200) || null });
    return "refunded";
  }
}
