import { ForbiddenError, RateLimitError, UnsupportedMediaTypeError, hmacHex, type Clock, type Database, type OriginGuard, type RateLimiter } from "@/core";

/**
 * CSRF defence for cookie-authenticated writes: Origin (or Referer) must be our own site, and bodies must
 * be JSON unless the route explicitly opts into multipart (file uploads).
 */
export class SameOriginGuard implements OriginGuard {
  constructor(private readonly publicSiteUrl: string) {}

  async assert(req: Request, mode: "json" | "multipart"): Promise<void> {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const allowed = new Set([new URL(req.url).origin, this.publicSiteUrl.replace(/\/$/, "")].filter(Boolean));
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    const source = origin ?? (referer && URL.canParse(referer) ? new URL(referer).origin : null);
    if (!source || !allowed.has(source)) throw new ForbiddenError("bad_origin", "İstek kaynağı doğrulanamadı.");

    const contentType = req.headers.get("content-type") ?? "";
    if (mode === "multipart") {
      if (!contentType.startsWith("multipart/form-data")) throw new UnsupportedMediaTypeError("unsupported_media_type", "Dosya yüklemesi bekleniyor.");
      return;
    }
    if (req.method !== "DELETE" && !contentType.includes("application/json")) {
      throw new UnsupportedMediaTypeError("unsupported_media_type", "JSON bekleniyor.");
    }
  }
}

/**
 * Client IP as seen by the reverse proxy (Caddy sets X-Real-IP to the TCP peer and overwrites whatever the client sent;
 * the app container publishes no port in production, so nothing else can reach it).
 */
export const clientIp = (req: Request): string => req.headers.get("x-real-ip") ?? "0.0.0.0";

/**
 * Fixed-window rate limiter stored in D1 (rate_limit_buckets). Bucket keys are "<name>:<subject>";
 * the subject is never a raw IP — `clientKey()` returns an HMAC of it.
 */
export class D1RateLimiter implements RateLimiter {
  constructor(private readonly db: Database, private readonly clock: Clock, private readonly secret: string) {}

  async hit(key: string, limit: number, windowSec: number): Promise<void> {
    const { windowStart, expiresAt } = this.window(windowSec);
    await this.db.run(
      `INSERT INTO rate_limit_buckets (bucket_key, window_start, attempts, expires_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(bucket_key, window_start) DO UPDATE SET attempts = attempts + 1`,
      key, windowStart, expiresAt,
    );
    if ((await this.attempts(key, windowStart)) > limit) throw new RateLimitError();
  }

  async check(key: string, limit: number, windowSec: number): Promise<void> {
    if ((await this.attempts(key, this.window(windowSec).windowStart)) >= limit) throw new RateLimitError();
  }

  clientKey(req: Request): Promise<string> {
    return hmacHex(this.secret, `ip:${clientIp(req)}`);
  }

  private window(windowSec: number) {
    const now = this.clock.now().getTime();
    return {
      windowStart: new Date(Math.floor(now / (windowSec * 1000)) * windowSec * 1000).toISOString(),
      expiresAt: new Date(now + windowSec * 2000).toISOString(),
    };
  }

  private async attempts(key: string, windowStart: string): Promise<number> {
    const row = await this.db.first<{ attempts: number }>("SELECT attempts FROM rate_limit_buckets WHERE bucket_key = ? AND window_start = ?", key, windowStart);
    return row?.attempts ?? 0;
  }
}
