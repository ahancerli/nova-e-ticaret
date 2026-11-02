import "server-only";
import { ApiError } from "./http";
import { getDb, getEnv } from "./db";
import { hmacHex } from "./crypto";

/**
 * CSRF defence for cookie-authenticated writes: Origin (or Referer) must be our own site.
 * Bodies must be JSON unless the route explicitly opts into multipart (file uploads).
 */
export async function assertSameOrigin(req: Request, opts: { multipart?: boolean } = {}): Promise<void> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  const env = await getEnv();
  const own = new URL(req.url).origin;
  const allowed = new Set([own, env.PUBLIC_SITE_URL?.replace(/\/$/, "")].filter(Boolean));
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const source = origin ?? (referer ? new URL(referer).origin : null);
  if (!source || !allowed.has(source)) throw new ApiError(403, "bad_origin", "İstek kaynağı doğrulanamadı.");
  const ct = req.headers.get("content-type") ?? "";
  if (opts.multipart) {
    if (!ct.startsWith("multipart/form-data")) throw new ApiError(415, "unsupported_media_type", "Dosya yüklemesi bekleniyor.");
    return;
  }
  if (req.method !== "DELETE" && !ct.includes("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "JSON bekleniyor.");
  }
}

/** Client IP as seen by Cloudflare (CF-Connecting-IP is set by the edge, not the client). */
export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? "0.0.0.0";
}

export async function ipHash(req: Request): Promise<string> {
  const env = await getEnv();
  return hmacHex(env.SESSION_SECRET, `ip:${clientIp(req)}`);
}

/**
 * Fixed-window rate limit stored in D1 (rate_limit_buckets).
 * Source spec: login and coupon → max 5 failed attempts per IP per minute.
 * `record` = false only checks; call `hit` after a failure.
 */
export async function rateLimit(opts: { key: string; limit: number; windowSec: number; record?: boolean }) {
  const db = await getDb();
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (opts.windowSec * 1000)) * opts.windowSec * 1000).toISOString();
  const expiresAt = new Date(now + opts.windowSec * 2000).toISOString();
  if (opts.record !== false) {
    await db
      .prepare(
        `INSERT INTO rate_limit_buckets (bucket_key, window_start, attempts, expires_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(bucket_key, window_start) DO UPDATE SET attempts = attempts + 1`,
      )
      .bind(opts.key, windowStart, expiresAt)
      .run();
  }
  const row = await db
    .prepare("SELECT attempts FROM rate_limit_buckets WHERE bucket_key = ? AND window_start = ?")
    .bind(opts.key, windowStart)
    .first<{ attempts: number }>();
  const attempts = row?.attempts ?? 0;
  if (attempts > opts.limit || (opts.record === false && attempts >= opts.limit)) {
    throw new ApiError(429, "rate_limited", "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.");
  }
}

/** Escapes text for HTML contexts (reviews, names) — React already escapes JSX text. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Allowlist HTML sanitizer for admin-authored rich text (product descriptions, content pages).
 * Keeps a small tag set, strips every attribute except safe href on <a>.
 * For untrusted user content (reviews) never render HTML at all — use plain text.
 */
const ALLOWED_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h2", "h3", "h4", "blockquote", "a", "table", "thead", "tbody", "tr", "th", "td"]);
export function sanitizeRichHtml(html: string): string {
  const withoutBlocks = html.replace(/<(script|style|iframe|object|embed|template|noscript)[\s\S]*?<\/\1\s*>/gi, "");
  return withoutBlocks.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (full, tagRaw: string, attrs: string) => {
    const tag = tagRaw.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    const closing = full.startsWith("</");
    if (closing) return `</${tag}>`;
    if (tag === "a") {
      const m = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
      const href = (m?.[2] ?? m?.[3] ?? "").trim();
      if (/^(https:\/\/|\/(?!\/))/i.test(href)) {
        return `<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">`;
      }
      return "<a>";
    }
    return `<${tag}>`;
  });
}
