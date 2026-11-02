import { NextResponse } from "next/server";
import { LoggerToken, RateLimitError, RateLimiterToken } from "@/core";
import { TOKEN_PATTERN, VerifyCardPaymentToken } from "@/modules/payments";
import { container, resolveService } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * iyzico webhook. The payload is never trusted: it only says WHICH token to re-verify through the
 * authenticated detail API. Duplicate deliveries are de-duplicated by payment_events UNIQUE(provider, event id).
 * Answers 5xx on failure so the provider retries; unauthenticated volume is capped per IP.
 *
 * TODO(before production): also verify the X-IYZ-SIGNATURE-V3 header per the current iyzico docs and
 * store signature_valid = 1. Until then the API re-verification is the trust anchor.
 */
export async function POST(req: Request) {
  try {
    const limiter = await resolveService(RateLimiterToken);
    await limiter.hit(`iyzico-webhook:${await limiter.clientKey(req)}`, 300, 60);
    const body = (await req.json().catch(() => ({}))) as { token?: string; iyziEventType?: string; iyziReferenceCode?: string; paymentId?: string | number };
    if (!body.token || !TOKEN_PATTERN.test(body.token)) return NextResponse.json({ ok: true });
    const eventId = `webhook:${body.iyziReferenceCode ?? body.paymentId ?? body.token}:${body.iyziEventType ?? "unknown"}`;
    await (await resolveService(VerifyCardPaymentToken)).execute(body.token, "webhook", eventId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RateLimitError) return NextResponse.json({ ok: false }, { status: 429 });
    container.resolve(LoggerToken).error("iyzico webhook failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
