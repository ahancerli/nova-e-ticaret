export interface BusMessage<T = unknown> {
  key: string;
  value: T;
}

/** A batch handed to a consumer; nothing is acknowledged until `commit()` (at-least-once delivery). */
export interface ConsumedBatch<T = unknown> {
  records: BusMessage<T>[];
  commit(): Promise<void>;
}

/**
 * Message bus port (Kafka in production, D1 locally). Consumers use their own group name, so every integration
 * (Trendyol today, Hepsiburada tomorrow …) reads every message at its own pace.
 */
export interface MessageBus {
  readonly kind: "kafka" | "database";
  publish<T>(topic: string, messages: BusMessage<T>[]): Promise<void>;
  poll<T>(group: string, topic: string, max: number): Promise<ConsumedBatch<T>>;
  /** Short health text for the panel ("Kafka REST: bağlı", "Veritabanı kuyruğu: 12 bekleyen"). */
  status(): Promise<{ ok: boolean; detail: string }>;
}

export interface ChangeLogRow {
  id: number;
  kind: "content" | "stock" | "price" | "images";
  productId: string;
  variantId: string | null;
  createdAt: string;
}

/** catalog_change_log (filled by triggers) and the relay's cursor. */
export interface ChangeLogRepository {
  cursor(): Promise<number>;
  after(id: number, limit: number): Promise<ChangeLogRow[]>;
  advance(from: number, to: number): Promise<boolean>;
  prune(before: string, upTo: number): Promise<void>;
  backlog(): Promise<number>;
}
