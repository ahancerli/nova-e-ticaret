import { ExternalServiceError } from "@/core";
import type { BusMessage, ConsumedBatch, MessageBus } from "../application/ports";

/**
 * Kafka through its REST proxy, API v2 (Confluent REST Proxy, Redpanda HTTP Proxy / pandaproxy, Aiven Karapace).
 * Cloudflare Workers cannot open Kafka's binary TCP protocol, so produce and consume go over HTTPS:
 *
 *   produce  POST /topics/{topic}                                         records [{key, value}]
 *   consume  POST /consumers/{group}                                      → instance (auto commit OFF, earliest)
 *            POST /consumers/{group}/instances/{name}/subscription        topics [topic]
 *            GET  /consumers/{group}/instances/{name}/records             → [{topic, key, value, partition, offset}]
 *            POST /consumers/{group}/instances/{name}/offsets             {} = commit everything fetched
 *            DELETE /consumers/{group}/instances/{name}
 *
 * Every poll uses a short-lived consumer instance of the group (Workers keep no state between requests); offsets live in
 * Kafka's consumer group, so delivery is at-least-once and consumers are idempotent.
 */
export class KafkaRestBus implements MessageBus {
  readonly kind = "kafka" as const;

  constructor(private readonly cfg: { restUrl: string; username: string; password: string }, private readonly doFetch: typeof fetch = (...a) => fetch(...a)) {}

  private async call(method: string, path: string, body?: unknown, contentType = "application/vnd.kafka.v2+json", accept = "application/vnd.kafka.v2+json"): Promise<Response> {
    const headers: Record<string, string> = { accept };
    if (body !== undefined) headers["content-type"] = contentType;
    if (this.cfg.username) headers.authorization = `Basic ${btoa(`${this.cfg.username}:${this.cfg.password}`)}`;
    let res: Response;
    try {
      res = await this.doFetch(`${this.cfg.restUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new ExternalServiceError("kafka_unreachable", "Kafka REST proxy'ye ulaşılamadı.");
    }
    if (!res.ok && res.status !== 404) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      throw new ExternalServiceError("kafka_error", `Kafka REST ${res.status}: ${text}`);
    }
    return res;
  }

  async publish<T>(topic: string, messages: BusMessage<T>[]): Promise<void> {
    if (!messages.length) return;
    const res = await this.call("POST", `/topics/${encodeURIComponent(topic)}`, { records: messages.map((m) => ({ key: m.key, value: m.value })) }, "application/vnd.kafka.json.v2+json");
    if (res.status === 404) throw new ExternalServiceError("kafka_topic_missing", `Kafka topic yok: ${topic} (topic'leri oluşturun veya auto.create.topics.enable açın).`);
    const out = (await res.json().catch(() => null)) as { offsets?: { error_code?: number | null; error?: string | null }[] } | null;
    const failed = out?.offsets?.find((o) => o.error_code);
    if (failed) throw new ExternalServiceError("kafka_produce_failed", `Kafka yazma hatası: ${failed.error ?? failed.error_code}`);
  }

  async poll<T>(group: string, topic: string, max: number): Promise<ConsumedBatch<T>> {
    const name = `nova-${crypto.randomUUID().slice(0, 8)}`;
    const base = `/consumers/${encodeURIComponent(group)}/instances/${name}`;
    await this.call("POST", `/consumers/${encodeURIComponent(group)}`, {
      name, format: "json", "auto.offset.reset": "earliest", "auto.commit.enable": "false", "consumer.request.timeout.ms": "3000",
    });
    const close = () => this.call("DELETE", base).catch(() => undefined);
    try {
      await this.call("POST", `${base}/subscription`, { topics: [topic] });
      const records: BusMessage<T>[] = [];
      // the first fetch after joining often returns nothing while partitions are assigned
      for (let attempt = 0; attempt < 3 && records.length < max; attempt++) {
        const res = await this.call("GET", `${base}/records?timeout=3000&max_bytes=2000000`, undefined, undefined, "application/vnd.kafka.json.v2+json");
        const batch = res.status === 404 ? [] : ((await res.json()) as { key: string | null; value: T }[]);
        records.push(...batch.map((r) => ({ key: r.key ?? "", value: r.value })));
        if (batch.length) break;
      }
      return {
        records,
        commit: async () => {
          try {
            if (records.length) await this.call("POST", `${base}/offsets`, {});
          } finally {
            await close();
          }
        },
      };
    } catch (e) {
      await close();
      throw e;
    }
  }

  async status() {
    try {
      const res = await this.call("GET", "/topics");
      const topics = res.status === 404 ? [] : ((await res.json()) as string[]);
      return { ok: true, detail: `Kafka REST bağlı · ${topics.length} topic` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "Kafka'ya ulaşılamadı" };
    }
  }
}
