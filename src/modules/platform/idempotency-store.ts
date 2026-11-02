import { BadRequestError, ConflictError, sha256Hex, type Clock, type Database, type IdempotencyStore } from "@/core";

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
const TTL_MINUTES = 24 * 60;

/**
 * Idempotency-Key handling (spec §09) in D1 (idempotency_keys):
 * same key + same body → stored response; same key + different body → 409; concurrent duplicate → 409.
 * A failed run frees the key so the client may retry with it.
 */
export class D1IdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Database, private readonly clock: Clock) {}

  async run<T>(req: Request, scope: string, body: unknown, fn: () => Promise<{ status: number; data: T }>) {
    const key = req.headers.get("idempotency-key");
    if (!key || !KEY_PATTERN.test(key)) throw new BadRequestError("idempotency_key_required", "Idempotency-Key başlığı gerekli.");
    const requestHash = await sha256Hex(JSON.stringify(body));

    const claimed = await this.db.run(
      `INSERT INTO idempotency_keys (scope, key, request_hash, status, expires_at) VALUES (?, ?, ?, 'processing', ?)
       ON CONFLICT(scope, key) DO NOTHING`,
      scope, key, requestHash, this.clock.addMinutesIso(TTL_MINUTES),
    );
    if (claimed.changes === 0) {
      const prev = await this.db.first<{ request_hash: string; status: string; response_status: number | null; response_json: string | null }>(
        "SELECT request_hash, status, response_status, response_json FROM idempotency_keys WHERE scope = ? AND key = ?", scope, key,
      );
      if (!prev || prev.request_hash !== requestHash) throw new ConflictError("idempotency_mismatch", "Aynı anahtar farklı bir istekle kullanıldı.");
      if (prev.status === "completed" && prev.response_json) {
        return { status: prev.response_status ?? 200, data: JSON.parse(prev.response_json) as T, replayed: true };
      }
      // Only one retry may take over a failed key.
      const retaken = await this.db.run("UPDATE idempotency_keys SET status = 'processing' WHERE scope = ? AND key = ? AND status = 'failed'", scope, key);
      if (retaken.changes === 0) throw new ConflictError("idempotency_in_progress", "İstek işleniyor, lütfen bekleyin.");
    }

    try {
      const result = await fn();
      await this.db.run(
        "UPDATE idempotency_keys SET status = 'completed', response_status = ?, response_json = ? WHERE scope = ? AND key = ?",
        result.status, JSON.stringify(result.data), scope, key,
      );
      return { ...result, replayed: false };
    } catch (err) {
      await this.db.run("UPDATE idempotency_keys SET status = 'failed', created_at = ? WHERE scope = ? AND key = ?", this.clock.nowIso(), scope, key);
      throw err;
    }
  }
}
