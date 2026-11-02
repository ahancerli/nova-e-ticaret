"use client";

/**
 * Browser error reporting → POST /api/client-errors → server JSON log (Workers observability).
 * Used by error boundaries (render errors) and the global listener (uncaught errors / rejections).
 * Fire-and-forget, never throws, bounded per page so a crash loop cannot flood the endpoint.
 */
export type ClientErrorKind = "render" | "uncaught" | "unhandled_rejection" | "boundary";

const MAX_REPORTS_PER_PAGE = 10;
const sent = new Set<string>();
let count = 0;

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : undefined);

export function reportClientError(error: unknown, ctx: { kind: ClientErrorKind; digest?: string; boundary?: string } = { kind: "uncaught" }): void {
  try {
    if (typeof window === "undefined" || count >= MAX_REPORTS_PER_PAGE) return;
    const e = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Non-Error thrown");
    const key = `${ctx.kind}:${e.message}:${ctx.digest ?? ""}`;
    if (sent.has(key)) return;
    sent.add(key);
    count++;
    const body = JSON.stringify({
      kind: ctx.kind,
      message: clip(e.message, 500) ?? "unknown",
      name: clip(e.name, 100),
      stack: clip(e.stack, 4000),
      digest: clip(ctx.digest, 100),
      boundary: clip(ctx.boundary, 100),
      // Path only: query strings may carry search terms or tokens.
      path: clip(window.location.pathname, 300),
    });
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/client-errors", blob)) {
      void fetch("/api/client-errors", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => undefined);
    }
  } catch {
    /* reporting must never break the page */
  }
}
