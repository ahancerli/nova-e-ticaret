import "server-only";
import { getDb } from "./db";
import { sha256Hex } from "./crypto";
import { ApiError } from "./http";
import { addMinutesIso, nowIso } from "@/lib/ids";

/**
 * Idempotency-Key handling (spec §09): same key + same body → replay stored response;
 * same key + different body → 409; concurrent duplicate → 409 in-progress.
 */
export async function withIdempotency<T>(req: Request, scope: string, body: unknown, run: () => Promise<{ status: number; data: T }>) {
  const key = req.headers.get("idempotency-key");
  if (!key || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
    throw new ApiError(400, "idempotency_key_required", "Idempotency-Key başlığı gerekli.");
  }
  const db = await getDb();
  const requestHash = await sha256Hex(JSON.stringify(body));
  const claimed = await db
    .prepare(`INSERT INTO idempotency_keys (scope, key, request_hash, status, expires_at) VALUES (?, ?, ?, 'processing', ?)
              ON CONFLICT(scope, key) DO NOTHING`)
    .bind(scope, key, requestHash, addMinutesIso(24 * 60))
    .run();

  if ((claimed.meta.changes ?? 0) === 0) {
    const prev = await db
      .prepare("SELECT request_hash, status, response_status, response_json FROM idempotency_keys WHERE scope = ? AND key = ?")
      .bind(scope, key)
      .first<{ request_hash: string; status: string; response_status: number | null; response_json: string | null }>();
    if (!prev || prev.request_hash !== requestHash) throw new ApiError(409, "idempotency_mismatch", "Aynı anahtar farklı bir istekle kullanıldı.");
    if (prev.status === "completed" && prev.response_json) return { status: prev.response_status ?? 200, data: JSON.parse(prev.response_json) as T, replayed: true };
    if (prev.status === "processing") throw new ApiError(409, "idempotency_in_progress", "İstek işleniyor, lütfen bekleyin.");
    // failed → allow retry with the same key
    await db.prepare("UPDATE idempotency_keys SET status = 'processing' WHERE scope = ? AND key = ?").bind(scope, key).run();
  }

  try {
    const result = await run();
    await db
      .prepare("UPDATE idempotency_keys SET status = 'completed', response_status = ?, response_json = ? WHERE scope = ? AND key = ?")
      .bind(result.status, JSON.stringify(result.data), scope, key)
      .run();
    return { ...result, replayed: false };
  } catch (err) {
    await db.prepare("UPDATE idempotency_keys SET status = 'failed', created_at = ? WHERE scope = ? AND key = ?").bind(nowIso(), scope, key).run();
    throw err;
  }
}
