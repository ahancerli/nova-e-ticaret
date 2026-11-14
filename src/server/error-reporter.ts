import "server-only";
import type { ErrorReport } from "@/core";

/**
 * Error monitoring without an SDK: server errors go to any Sentry-compatible service (Sentry, GlitchTip, Bugsink) over
 * its HTTP envelope API. Configured by `SENTRY_DSN` (empty = off); `SENTRY_ENVIRONMENT` (default APP_ENV) and
 * `SENTRY_RELEASE` are optional. Sources: every `logger.error` line (5xx in routes, outbox / cron failures), server
 * render errors (src/instrumentation.ts) and browser errors (/api/client-errors).
 *
 * Fire-and-forget, never throws. Per process at most MAX_PER_MINUTE events, and one event per message+route per
 * DEDUPE_MS, so an error loop cannot flood the quota. Only redacted log fields are sent; no request bodies, cookies
 * or headers.
 */

const MAX_PER_MINUTE = 30;
const DEDUPE_MS = 60_000;
const TIMEOUT_MS = 3_000;

export interface CapturedError {
  message: string;
  error?: unknown;
  level?: "error" | "warning";
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
  /** Path + method of the request, when there is one. */
  request?: { url?: string; method?: string };
  /** Browser stack (already a string) for client errors. */
  stack?: string;
}

interface Dsn { envelopeUrl: string; publicKey: string; raw: string }

export function parseDsn(dsn: string): Dsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.split("/").filter(Boolean).pop();
    const prefix = u.pathname.replace(/\/[^/]*\/?$/, "");
    if (!u.username || !projectId || !/^\d+$/.test(projectId)) return null;
    return { envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`, publicKey: u.username, raw: dsn };
  } catch {
    return null;
  }
}

/** "at fn (file:line:col)" lines → Sentry frames (oldest first). */
function framesOf(stack: string) {
  return stack.split("\n").slice(1, 40).map((line) => {
    const m = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
    return m ? { function: m[1] ?? "?", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]), in_app: !m[2]!.includes("node_modules") } : { function: line.trim() };
  }).reverse();
}

export class ErrorReporter {
  private sentAt: number[] = [];
  private recent = new Map<string, number>();

  constructor(private readonly dsn: Dsn | null, private readonly meta: { environment: string; release?: string; serverName?: string }) {}

  get enabled() { return this.dsn !== null; }

  capture(e: CapturedError): void {
    if (!this.dsn) return;
    const now = Date.now();
    const key = `${e.message}|${e.tags?.route ?? ""}|${e.error instanceof Error ? e.error.message : ""}`;
    if ((this.recent.get(key) ?? 0) > now - DEDUPE_MS) return;
    this.sentAt = this.sentAt.filter((t) => t > now - 60_000);
    if (this.sentAt.length >= MAX_PER_MINUTE) return;
    this.sentAt.push(now);
    this.recent.set(key, now);
    if (this.recent.size > 500) for (const [k, t] of this.recent) if (t <= now - DEDUPE_MS) this.recent.delete(k);
    void this.send(e).catch(() => { /* monitoring must never break the app */ });
  }

  /** Bridges JsonLogger's `report` option: every `error` line becomes an event. */
  fromLog = (r: ErrorReport): void => {
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    // `error` is the serialized copy of r.error (stack-less in production); the event carries the real one
    const extra = Object.fromEntries(Object.entries(r.fields).filter(([k]) => k !== "error"));
    this.capture({
      message: r.message, error: r.error, extra,
      tags: { route: str(r.bindings.route), requestId: str(r.bindings.requestId), code: str(r.fields.code), source: str(r.bindings.source) },
    });
  };

  private async send(e: CapturedError): Promise<void> {
    const dsn = this.dsn!;
    const eventId = crypto.randomUUID().replace(/-/g, "");
    const err = e.error instanceof Error ? e.error : null;
    const stack = err?.stack ?? e.stack;
    const tags = Object.fromEntries(Object.entries(e.tags ?? {}).filter(([, v]) => v)) as Record<string, string>;
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level: e.level ?? "error",
      environment: this.meta.environment,
      ...(this.meta.release ? { release: this.meta.release } : {}),
      ...(this.meta.serverName ? { server_name: this.meta.serverName } : {}),
      message: { formatted: e.message },
      ...(err || stack ? {
        exception: { values: [{ type: err?.name ?? "Error", value: (err?.message ?? e.message).slice(0, 1000), ...(stack ? { stacktrace: { frames: framesOf(stack) } } : {}) }] },
      } : {}),
      ...(e.request ? { request: e.request } : {}),
      tags,
      extra: e.extra ?? {},
    };
    const body = [JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: dsn.raw }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
    await fetch(dsn.envelopeUrl, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=nova/1.0` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
}

declare global {
  var __novaErrorReporter: ErrorReporter | undefined;
}

/** One reporter per process (route modules are bundled separately; they share it through globalThis). */
export function errorReporter(): ErrorReporter {
  globalThis.__novaErrorReporter ??= new ErrorReporter(parseDsn(process.env.SENTRY_DSN ?? ""), {
    environment: process.env.SENTRY_ENVIRONMENT || process.env.APP_ENV || "development",
    release: process.env.SENTRY_RELEASE || undefined,
    serverName: process.env.HOSTNAME || undefined,
  });
  return globalThis.__novaErrorReporter;
}
