import type { Clock, Logger } from "@/core";
import { TOPIC_OF_CHANGE, topicName, type CatalogChangeMessage } from "../domain/topics";
import type { ChangeLogRepository, MessageBus } from "./ports";

/**
 * Command (cron): publishes captured catalog changes to the bus. Rows are coalesced — fifty stock movements of a
 * variant in a minute become one "stock changed" message — then the cursor moves past them (guarded, so two relays
 * never publish the same rows twice in a row; a crash between publish and cursor move only re-publishes, which
 * consumers tolerate because messages are notifications). Relayed rows older than 7 days are pruned.
 */
export class RelayCatalogChanges {
  constructor(private readonly log: ChangeLogRepository, private readonly bus: MessageBus, private readonly prefix: string, private readonly clock: Clock, private readonly logger: Logger) {}

  async execute(maxRows = 2000): Promise<{ rows: number; messages: number }> {
    const from = await this.log.cursor();
    const rows = await this.log.after(from, maxRows);
    if (!rows.length) return { rows: 0, messages: 0 };
    const coalesced = new Map<string, CatalogChangeMessage>();
    for (const r of rows) coalesced.set(`${r.kind}:${r.productId}:${r.variantId ?? ""}`, { kind: r.kind, productId: r.productId, variantId: r.variantId, at: r.createdAt });
    const byTopic = new Map<string, { key: string; value: CatalogChangeMessage }[]>();
    for (const m of coalesced.values()) {
      const topic = topicName(this.prefix, TOPIC_OF_CHANGE[m.kind]);
      byTopic.set(topic, [...(byTopic.get(topic) ?? []), { key: m.productId, value: m }]);
    }
    for (const [topic, messages] of byTopic) {
      for (let i = 0; i < messages.length; i += 500) await this.bus.publish(topic, messages.slice(i, i + 500));
    }
    const to = rows.at(-1)!.id;
    if (!(await this.log.advance(from, to))) this.logger.warn("change relay cursor moved concurrently", { from, to });
    await this.log.prune(new Date(this.clock.now().getTime() - 7 * 86_400_000).toISOString(), to);
    return { rows: rows.length, messages: coalesced.size };
  }
}
