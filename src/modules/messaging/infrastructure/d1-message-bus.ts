import { Repository, type Database } from "@/core";
import type { BusMessage, ChangeLogRepository, ChangeLogRow, ConsumedBatch, MessageBus } from "../application/ports";

/**
 * Message bus on D1 (INTEGRATION_BUS=database): an append-only log per topic + a committed position per consumer
 * group — Kafka's model, so switching to Kafka changes no consumer code. Messages older than 7 days are pruned.
 */
export class D1MessageBus implements MessageBus {
  readonly kind = "database" as const;
  constructor(private readonly db: Database) {}

  async publish<T>(topic: string, messages: BusMessage<T>[]): Promise<void> {
    if (!messages.length) return;
    await this.db.batch(messages.map((m) => this.db.statement("INSERT INTO integration_messages (topic, msg_key, payload_json) VALUES (?, ?, ?)", topic, m.key, JSON.stringify(m.value))));
  }

  async poll<T>(group: string, topic: string, max: number): Promise<ConsumedBatch<T>> {
    const at = (await this.db.first<{ last_id: number }>("SELECT last_id FROM integration_consumer_offsets WHERE consumer_group = ? AND topic = ?", group, topic))?.last_id ?? 0;
    const rows = await this.db.all<{ id: number; msg_key: string | null; payload_json: string }>(
      "SELECT id, msg_key, payload_json FROM integration_messages WHERE topic = ? AND id > ? ORDER BY id LIMIT ?", topic, at, max,
    );
    const last = rows.at(-1)?.id ?? at;
    return {
      records: rows.map((r) => ({ key: r.msg_key ?? "", value: JSON.parse(r.payload_json) as T })),
      commit: async () => {
        if (last === at) return;
        await this.db.run(
          `INSERT INTO integration_consumer_offsets (consumer_group, topic, last_id) VALUES (?, ?, ?)
           ON CONFLICT (consumer_group, topic) DO UPDATE SET last_id = MAX(last_id, excluded.last_id), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
          group, topic, last,
        );
        await this.db.run("DELETE FROM integration_messages WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')");
      },
    };
  }

  async status() {
    const r = await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM integration_messages");
    return { ok: true, detail: `Veritabanı kuyruğu (Kafka kapalı) · ${r?.n ?? 0} mesaj` };
  }
}

export class D1ChangeLogRepository extends Repository implements ChangeLogRepository {
  async cursor(): Promise<number> {
    return (await this.db.first<{ last_change_id: number }>("SELECT last_change_id FROM integration_relay_state WHERE id = 1"))?.last_change_id ?? 0;
  }

  async after(id: number, limit: number): Promise<ChangeLogRow[]> {
    const rows = await this.db.all<{ id: number; kind: ChangeLogRow["kind"]; product_id: string; variant_id: string | null; created_at: string }>(
      "SELECT id, kind, product_id, variant_id, created_at FROM catalog_change_log WHERE id > ? ORDER BY id LIMIT ?", id, limit,
    );
    return rows.map((r) => ({ id: r.id, kind: r.kind, productId: r.product_id, variantId: r.variant_id, createdAt: r.created_at }));
  }

  async advance(from: number, to: number): Promise<boolean> {
    const r = await this.db.run(
      `INSERT INTO integration_relay_state (id, last_change_id) VALUES (1, ?2)
       ON CONFLICT (id) DO UPDATE SET last_change_id = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE integration_relay_state.last_change_id = ?1`,
      from, to,
    );
    return r.changes === 1;
  }

  async prune(before: string, upTo: number): Promise<void> {
    await this.db.run("DELETE FROM catalog_change_log WHERE id <= ? AND created_at < ?", upTo, before);
  }

  async backlog(): Promise<number> {
    return (await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM catalog_change_log WHERE id > (SELECT last_change_id FROM integration_relay_state WHERE id = 1)"))?.n ?? 0;
  }
}
