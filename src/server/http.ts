import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { dbErrorCode } from "./db";

/** Response contract: { data, meta, requestId } | { error: { code, message, fieldErrors }, requestId } */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export function requestId(req: Request): string {
  return req.headers.get("cf-ray") ?? crypto.randomUUID();
}

export function ok<T>(req: Request, data: T, meta?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ data, meta: meta ?? {}, requestId: requestId(req) }, { status });
}

const DB_ERROR_STATUS: Record<string, [number, string]> = {
  insufficient_stock: [409, "Stok yetersiz."],
  campaign_capacity_exceeded: [409, "Kampanya kapasitesi doldu."],
  coupon_limit_reached: [409, "Kupon kullanım limiti doldu."],
  coupon_customer_limit_reached: [409, "Bu kuponu daha önce kullandınız."],
  coupon_inactive: [409, "Kupon geçerli değil."],
  category_cycle: [422, "Kategori hiyerarşisinde döngü oluşturulamaz."],
  conflict: [409, "Kayıt çakışması."],
  invalid_reference: [422, "Geçersiz referans."],
  invalid_value: [422, "Geçersiz değer."],
};

export function fail(req: Request, err: unknown) {
  const rid = requestId(req);
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, fieldErrors: err.fieldErrors ?? {} }, requestId: rid },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return NextResponse.json(
      { error: { code: "validation_error", message: "Girdi doğrulanamadı.", fieldErrors }, requestId: rid },
      { status: 422 },
    );
  }
  const code = dbErrorCode(err);
  if (code && DB_ERROR_STATUS[code]) {
    const [status, message] = DB_ERROR_STATUS[code];
    return NextResponse.json({ error: { code, message, fieldErrors: {} }, requestId: rid }, { status });
  }
  // Never leak internals to the client; detail goes to Workers observability logs.
  console.error(JSON.stringify({ level: "error", requestId: rid, message: err instanceof Error ? err.message : String(err) }));
  return NextResponse.json(
    { error: { code: "internal_error", message: "Beklenmeyen bir hata oluştu.", fieldErrors: {} }, requestId: rid },
    { status: 500 },
  );
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

export async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new ApiError(413, "payload_too_large", "İstek çok büyük.");
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError(413, "payload_too_large", "İstek çok büyük.");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Geçersiz JSON.");
  }
}
