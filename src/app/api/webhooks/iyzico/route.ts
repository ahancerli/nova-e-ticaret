import { NextResponse } from "next/server";
import { LoggerToken, RateLimitError, RateLimiterToken } from "@/core";
import { PaymentGatewayToken, TOKEN_PATTERN, VerifyCardPaymentToken, type IyzicoWebhookBody } from "@/modules/payments";
import { container, resolveService } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * iyzico webhook (Checkout Form = HPP format). The payload is never trusted on its own: it only says WHICH token to
 * re-verify through the authenticated detail API. Duplicate deliveries are de-duplicated by payment_events
 * UNIQUE(provider, event id). Answers 5xx on failure so iyzico retries; unauthenticated volume is capped per IP.
 *
 * X-IYZ-SIGNATURE-V3 (docs: Webhook): sent only once iyzico switches the feature on for the account (ask
 * entegrasyon@iyzico.com). Present and wrong → 401, nothing processed. Present and right → signature_valid = 1.
 * Absent → processed as before (the API re-verification stays the trust anchor).
 */
export async function POST(req: Request) {
  try {
    const limiter = await resolveService(RateLimiterToken);
    await limiter.hit(`iyzico-webhook:${await limiter.clientKey(req)}`, 300, 60);
    const body = (await req.json().catch(() => ({}))) as IyzicoWebhookBody;
    if (!body.token || !TOKEN_PATTERN.test(body.token)) return NextResponse.json({ ok: true });

    const header = req.headers.get("x-iyz-signature-v3");
    let signatureValid = false;
    if (header) {
      const valid = await (await resolveService(PaymentGatewayToken)).webhookSignatureValid(body, header.trim());
      if (valid === false) {
        container.resolve(LoggerToken).warn("iyzico webhook signature mismatch", { eventType: body.iyziEventType ?? null });
        return NextResponse.json({ ok: false }, { status: 401 });
      }
      signatureValid = valid === true;
    }
    const eventId = `webhook:${body.iyziReferenceCode ?? body.iyziPaymentId ?? body.paymentId ?? body.token}:${body.iyziEventType ?? "unknown"}`;
    await (await resolveService(VerifyCardPaymentToken)).execute(body.token, "webhook", eventId, signatureValid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RateLimitError) return NextResponse.json({ ok: false }, { status: 429 });
    container.resolve(LoggerToken).error("iyzico webhook failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
