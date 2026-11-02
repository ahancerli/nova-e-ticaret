import { NextResponse } from "next/server";
import { ConfigToken, LoggerToken, RateLimitError, RateLimiterToken } from "@/core";
import { VerifyCardPaymentToken } from "@/modules/payments";
import { container, resolveService } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * iyzico redirects the buyer's browser here (form POST with `token`). Not a JSON route: it always answers
 * with a redirect to the result page. Trust comes from the server-to-server verification, not from cookies;
 * PII never goes into the URL. Calls are rate-limited per IP.
 */
export async function POST(req: Request) {
  const base = (await resolveService(ConfigToken)).publicSiteUrl;
  const result = (q: Record<string, string>) => NextResponse.redirect(`${base}/siparis/sonuc?${new URLSearchParams(q)}`, 303);
  try {
    const limiter = await resolveService(RateLimiterToken);
    await limiter.hit(`iyzico-callback:${await limiter.clientKey(req)}`, 30, 60);
    const token = String((await req.formData()).get("token") ?? "");
    const r = await (await resolveService(VerifyCardPaymentToken)).execute(token, "callback");
    return result({ durum: r.status === "paid" ? "basarili" : "hata", ...(r.orderNumber ? { no: r.orderNumber } : {}) });
  } catch (err) {
    if (!(err instanceof RateLimitError)) container.resolve(LoggerToken).error("iyzico callback failed", { error: err instanceof Error ? err.message : String(err) });
    return result({ durum: "hata" });
  }
}
