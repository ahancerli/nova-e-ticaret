import "server-only";
import { OriginGuardToken, RateLimiterToken } from "@/core";
import { resolveService } from "./app";

/**
 * Legacy facade over the platform module for routes not yet on route() (cart, checkout, orders, webhooks).
 * New code declares csrf / rateLimit on route() or injects RateLimiter / OriginGuard.
 */
export { escapeHtml, sanitizeRichHtml } from "@/core";
export { clientIp } from "@/modules/platform/module";

export async function assertSameOrigin(req: Request, opts: { multipart?: boolean } = {}): Promise<void> {
  await (await resolveService(OriginGuardToken)).assert(req, opts.multipart ? "multipart" : "json");
}

export async function ipHash(req: Request): Promise<string> {
  return (await resolveService(RateLimiterToken)).clientKey(req);
}

/** `record: false` only checks the bucket; otherwise the hit is counted first. */
export async function rateLimit(opts: { key: string; limit: number; windowSec: number; record?: boolean }): Promise<void> {
  const limiter = await resolveService(RateLimiterToken);
  if (opts.record === false) await limiter.check(opts.key, opts.limit, opts.windowSec);
  else await limiter.hit(opts.key, opts.limit, opts.windowSec);
}
