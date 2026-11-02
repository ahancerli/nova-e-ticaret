import "server-only";
import { NextResponse } from "next/server";
import { AppError, JsonLogger, errorResponse, readJsonBody } from "@/core";

/**
 * Legacy route helpers, kept while routes migrate to `route()` from ./app (Phase 3).
 * Error handling is already the core pipeline's: ApiError IS an AppError and fail() uses errorResponse().
 */
export class ApiError extends AppError {
  constructor(status: number, code: string, message: string, fieldErrors?: Record<string, string[]>) {
    super(status, code, message, { fieldErrors });
  }
}

export function requestId(req: Request): string {
  return req.headers.get("cf-ray") ?? crypto.randomUUID();
}

export function ok<T>(req: Request, data: T, meta?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ data, meta: meta ?? {}, requestId: requestId(req) }, { status });
}

const logger = new JsonLogger({ level: process.env.NODE_ENV === "production" ? "info" : "debug" });

export function fail(req: Request, err: unknown): Response {
  const rid = requestId(req);
  return errorResponse(err, {
    requestId: rid,
    logger: logger.child({ requestId: rid, route: `${req.method} ${new URL(req.url).pathname}` }),
    exposeStack: process.env.NODE_ENV !== "production",
  });
}

/** Wraps a route handler with the error contract. */
export function handler<C>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return fail(req, err);
    }
  };
}

export function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  return readJsonBody(req, maxBytes);
}
