import { NextResponse } from "next/server";
import { verifyAndSettle } from "@/server/services/iyzico";
import { ApiError } from "@/server/http";
import { ipHash, rateLimit } from "@/server/security";

export const dynamic = "force-dynamic";

/**
 * iyzico webhook. We never trust the payload itself: it only tells us WHICH token/payment to
 * re-verify through the authenticated detail API. Duplicate deliveries are de-duplicated by
 * payment_events UNIQUE(provider, provider_event_id).
 *
 * TODO(before production): also verify the X-IYZ-SIGNATURE-V3 header per current iyzico docs
 * and store signature_valid = 1. Until then the API re-verification is the trust anchor.
 */
export async function POST(req: Request) {
  try {
    // Each accepted call triggers an outbound verification request, so unauthenticated volume is capped.
    await rateLimit({ key: `iyzico-webhook:${await ipHash(req)}`, limit: 300, windowSec: 60 });
    const body = (await req.json()) as { token?: string; iyziEventType?: string; iyziReferenceCode?: string; paymentId?: string | number };
    if (!body.token || !/^[A-Za-z0-9-]{10,100}$/.test(body.token)) return NextResponse.json({ ok: true });
    const eventId = `webhook:${body.iyziReferenceCode ?? body.paymentId ?? body.token}:${body.iyziEventType ?? "unknown"}`;
    await verifyAndSettle(body.token, "webhook", eventId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ApiError && err.code === "rate_limited") return NextResponse.json({ ok: false }, { status: 429 });
    console.error(JSON.stringify({ level: "error", where: "iyzico.webhook", message: err instanceof Error ? err.message : String(err) }));
    // 5xx → provider retries later.
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
