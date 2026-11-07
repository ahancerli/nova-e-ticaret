/**
 * Integration topics (Kafka topic names = `${prefix}.${topic}`, default prefix "nova").
 * Catalog topics carry change notifications, not data: consumers read the current state when they act, so
 * reordering or replaying a message can never send stale stock or prices.
 */
export const TOPICS = {
  /** name, description, brand, category, attributes, variants (SKU, barcode, active) */
  productInfo: "catalog.product-info",
  stock: "catalog.stock",
  price: "catalog.price",
  images: "catalog.images",
  /** Marketplace order packages pulled from the marketplaces, written to the order system by their consumer. */
  marketplaceOrders: "marketplace.orders",
  /** Messages a consumer could not process after its retries. */
  deadLetter: "integrations.dead-letter",
} as const;
export type TopicKey = keyof typeof TOPICS;

export type ChangeKind = "content" | "stock" | "price" | "images";

/** Topic of a captured catalog change. */
export const TOPIC_OF_CHANGE: Record<ChangeKind, TopicKey> = { content: "productInfo", stock: "stock", price: "price", images: "images" };

/** Value of a catalog message (key = product id, so one product's changes stay in one partition, in order). */
export interface CatalogChangeMessage {
  kind: ChangeKind;
  productId: string;
  /** null = the whole product (name, description, category …). */
  variantId: string | null;
  /** Last capture time of the coalesced changes. */
  at: string;
}

export const topicName = (prefix: string, topic: TopicKey) => `${prefix}.${TOPICS[topic]}`;
