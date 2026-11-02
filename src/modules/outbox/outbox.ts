import { DatabaseToken, ClockToken, LoggerToken, Repository, token, type Clock, type Container, type Logger, type Resolver } from "@/core";

/**
 * Transactional outbox (spec §03): events are written in the same transaction as the business change and
 * delivered here, at-least-once, with a lock, exponential backoff and a dead state. Handlers MUST be
 * idempotent (they check their own state before acting).
 *
 * Modules contribute handlers with `addOutboxHandler(eventType, factory)` — the worker knows no module.
 * Trigger: POST /api/cron/outbox (Bearer CRON_SECRET) every minute — see README.
 */

export const LOCK_MINUTES = 5;
export const MAX_ATTEMPTS = 8;
export const backoffMinutes = (attempt: number) => Math.min(60, 2 ** Math.max(0, attempt - 1)); // 1, 2, 4 … 60

export type HandlerOutcome = { result: "done" | "skipped"; detail?: unknown };
export interface OutboxEvent {
  id: string;
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  attempts: number;
}
export interface OutboxHandler {
  handle(payload: Record<string, unknown>, event: OutboxEvent): Promise<HandlerOutcome>;
}

const handlerFactories = new Map<string, ((r: Resolver) => OutboxHandler)[]>();

/** Registers a handler for an event type. Several handlers per type run in registration order. */
export function addOutboxHandler(eventType: string, factory: (r: Resolver) => OutboxHandler): void {
  handlerFactories.set(eventType, [...(handlerFactories.get(eventType) ?? []), factory]);
}

export class OutboxRepository extends Repository {
  async due(now: string, limit: number): Promise<string[]> {
    const rows = await this.db.all<{ id: string }>(
      `SELECT id FROM outbox_events
        WHERE (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = 'processing' AND locked_until <= ?)
        ORDER BY created_at LIMIT ?`,
      now, now, limit,
    );
    return rows.map((r) => r.id);
  }

  /** Conditional claim: two concurrent workers never process the same event. */
  async claim(id: string, now: string, lockUntil: string): Promise<OutboxEvent | null> {
    const res = await this.db.run(
      `UPDATE outbox_events SET status = 'processing', locked_until = ?, attempts = attempts + 1
        WHERE id = ? AND ((status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = 'processing' AND locked_until <= ?))`,
      lockUntil, id, now, now,
    );
    if (res.changes !== 1) return null;
    const ev = await this.db.first<{ event_type: string; aggregate_id: string; payload_json: string; attempts: number }>(
      "SELECT event_type, aggregate_id, payload_json, attempts FROM outbox_events WHERE id = ?", id,
    );
    if (!ev) return null;
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(ev.payload_json) as Record<string, unknown>; } catch { /* json_valid CHECK makes this unreachable */ }
    return { id, eventType: ev.event_type, aggregateId: ev.aggregate_id, payload, attempts: ev.attempts };
  }

  /** Only while still holding the lock taken at claim time (a reclaimed event is left to its new owner). */
  async complete(id: string, lockUntil: string): Promise<void> {
    await this.db.run("UPDATE outbox_events SET status = 'done', locked_until = NULL WHERE id = ? AND status = 'processing' AND locked_until = ?", id, lockUntil);
  }

  async fail(id: string, lockUntil: string, dead: boolean, nextAttemptAt: string | null): Promise<void> {
    await this.db.run(
      "UPDATE outbox_events SET status = ?, next_attempt_at = ?, locked_until = NULL WHERE id = ? AND status = 'processing' AND locked_until = ?",
      dead ? "dead" : "pending", dead ? null : nextAttemptAt, id, lockUntil,
    );
  }
}

export interface OutboxSummary {
  claimed: number;
  done: number;
  skipped: number;
  retried: number;
  dead: number;
  errors: { id: string; eventType: string; error: string }[];
}

/** Command (cron): delivers up to `limit` due events. */
export class ProcessOutbox {
  constructor(private readonly repo: OutboxRepository, private readonly resolver: Resolver, private readonly clock: Clock, private readonly logger: Logger) {}

  async execute(limit = 25): Promise<OutboxSummary> {
    const summary: OutboxSummary = { claimed: 0, done: 0, skipped: 0, retried: 0, dead: 0, errors: [] };
    for (const id of await this.repo.due(this.clock.nowIso(), Math.min(Math.max(limit, 1), 100))) {
      const now = this.clock.now();
      const lockUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
      const ev = await this.repo.claim(id, now.toISOString(), lockUntil);
      if (!ev) continue;
      summary.claimed++;

      const handlers = (handlerFactories.get(ev.eventType) ?? []).map((make) => make(this.resolver));
      try {
        if (!handlers.length) throw new Error(`no_handler:${ev.eventType}`);
        let skipped = true;
        for (const h of handlers) skipped = (await h.handle(ev.payload, ev)).result === "skipped" && skipped;
        await this.repo.complete(id, lockUntil);
        if (skipped) summary.skipped++; else summary.done++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const dead = ev.attempts >= MAX_ATTEMPTS || !handlers.length;
        await this.repo.fail(id, lockUntil, dead, new Date(now.getTime() + backoffMinutes(ev.attempts) * 60_000).toISOString());
        if (dead) summary.dead++; else summary.retried++;
        summary.errors.push({ id, eventType: ev.eventType, error: message.slice(0, 200) });
        this.logger.warn("outbox event failed", { id, eventType: ev.eventType, attempts: ev.attempts, dead, error: message.slice(0, 200) });
      }
    }
    return summary;
  }
}

export const OutboxRepositoryToken = token<OutboxRepository>("OutboxRepository");
export const ProcessOutboxToken = token<ProcessOutbox>("ProcessOutbox");

export function registerOutbox(c: Container): void {
  c.scoped(OutboxRepositoryToken, (r) => new OutboxRepository(r.resolve(DatabaseToken)));
  c.scoped(ProcessOutboxToken, (r) => new ProcessOutbox(r.resolve(OutboxRepositoryToken), r, r.resolve(ClockToken), r.resolve(LoggerToken)));
}
