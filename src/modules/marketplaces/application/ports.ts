import type { Statement } from "@/core";
import type { ConnectionIntervals, ConnectionRow, ConnectionSettings, ConnectionStats, MarketplacePackage, MarketplaceProvider, Mappings, TrendyolItem, VariantSnapshot } from "../domain/marketplace";

export interface Credentials {
  apiKey: string;
  apiSecret: string;
}

/** One marketplace's API (Trendyol today). Everything else — mappings, queues, order import — is shared. */
export interface MarketplaceClient {
  test(): Promise<void>;
  categoryTree(): Promise<{ id: number; parentId: number | null; name: string; path: string; isLeaf: boolean }[]>;
  categoryAttributes(categoryId: number): Promise<{ id: number; name: string; required: boolean; allowCustom: boolean; varianter: boolean }[]>;
  attributeValues(categoryId: number, attributeId: number): Promise<{ id: number; name: string }[]>;
  brands(name: string): Promise<{ id: number; name: string }[]>;
  createProducts(items: TrendyolItem[]): Promise<string>;
  updateUnapproved(items: TrendyolItem[]): Promise<string>;
  updateApprovedContent(items: { contentId: number; item: TrendyolItem }[]): Promise<string>;
  updatePriceStock(items: { barcode: string; quantity?: number; salePrice?: number; listPrice?: number }[]): Promise<string>;
  batchResult(batchId: string): Promise<{ done: boolean; items: { barcode: string | null; ok: boolean; reasons: string[] }[] }>;
  productStatus(barcode: string): Promise<{ approved: boolean; rejected: boolean; contentId: number | null; reasons: string[] } | null>;
  orders(q: { startMs: number; endMs: number; page: number; size: number }): Promise<{ packages: MarketplacePackage[]; totalPages: number }>;
}

export type ClientFactory = (c: { provider: MarketplaceProvider; environment: "production" | "stage"; sellerId: string }, creds: Credentials) => MarketplaceClient;

export interface SealedJson {
  ciphertext: string;
  authTag: string;
  nonce: string;
}

export interface ConnectionWrite {
  provider: MarketplaceProvider;
  name: string;
  environment: "production" | "stage";
  sellerId: string;
  settings: ConnectionSettings;
  intervals: ConnectionIntervals;
  isActive: boolean;
}

export interface ListingRow {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  variantLabel: string;
  status: string;
  contentId: number | null;
  lastError: string | null;
  lastPushedAt: string | null;
  imageUrl: string | null;
}

export interface MarketplaceOrderRow {
  packageId: string;
  orderNumber: string;
  status: "imported" | "failed" | "skipped";
  externalStatus: string | null;
  error: string | null;
  orderId: string | null;
  ourOrderNumber: string | null;
  totalMinor: number | null;
  attempts: number;
  updatedAt: string;
}

export interface MarketplaceRepository {
  list(): Promise<(ConnectionRow & { stats: ConnectionStats })[]>;
  get(id: string): Promise<ConnectionRow | null>;
  sealed(id: string): Promise<SealedJson | null>;
  stats(id: string): Promise<ConnectionStats>;
  insertStatement(id: string, c: ConnectionWrite, sealed: SealedJson, actorId: string, now: string): Statement;
  updateStatement(id: string, c: ConnectionWrite, sealed: SealedJson | null, expectedUpdatedAt: string, now: string): Statement;
  deleteStatement(id: string): Statement;
  active(): Promise<ConnectionRow[]>;
  setNext(id: string, task: "orders" | "stock" | "price" | "content", at: string): Promise<void>;
  setResult(id: string, r: { lastError: string | null; ordersSyncedUntil?: number | null }, now: string): Promise<void>;
  ensureChannelCart(id: string): Promise<string>;

  // mappings
  categoryMappings(id: string): Promise<{ categoryId: string; externalCategoryId: number; path: string }[]>;
  brandMappings(id: string): Promise<{ brandId: string; externalBrandId: number; name: string }[]>;
  attributeMappings(id: string): Promise<{ externalCategoryId: number; externalAttributeId: number; name: string; attributeId: string | null; fixedValueId: number | null; fixedCustomValue: string | null }[]>;
  valueMappings(id: string): Promise<{ externalAttributeId: number; optionId: string; valueId: number | null; custom: string | null }[]>;
  setCategoryMapping(id: string, categoryId: string, ext: { id: number; path: string } | null): Promise<void>;
  setBrandMapping(id: string, brandId: string, ext: { id: number; name: string } | null): Promise<void>;
  replaceAttributeMappings(id: string, externalCategoryId: number, rules: { externalAttributeId: number; name: string; attributeId: string | null; fixedValueId: number | null; fixedCustomValue: string | null }[], values: { externalAttributeId: number; optionId: string; valueId: number | null; custom: string | null }[]): Promise<void>;
  mappings(id: string, provider: MarketplaceProvider): Promise<Mappings>;

  // reference caches
  cachedCategories(provider: MarketplaceProvider, q: string, limit: number): Promise<{ id: number; path: string; isLeaf: boolean }[]>;
  categoryCacheAge(provider: MarketplaceProvider): Promise<string | null>;
  replaceCategoryCache(provider: MarketplaceProvider, rows: { id: number; parentId: number | null; name: string; path: string; isLeaf: boolean }[], now: string): Promise<void>;
  cachedAttributes(provider: MarketplaceProvider, categoryId: number): Promise<{ payload: { id: number; name: string; required: boolean; allowCustom: boolean; varianter: boolean }[]; fetchedAt: string } | null>;
  cacheAttributes(provider: MarketplaceProvider, categoryId: number, payload: unknown, now: string): Promise<void>;

  // listings + queue
  listings(id: string, filter: { status?: string; q?: string }, limit: number): Promise<ListingRow[]>;
  addListings(id: string, productIds: string[]): Promise<number>;
  setListingsPaused(id: string, variantIds: string[], paused: boolean): Promise<void>;
  enqueueFromChanges(changes: { kind: "content" | "stock" | "price"; productIds: string[]; variantIds: string[] }): Promise<number>;
  enqueueAll(id: string, kinds: ("content" | "stock" | "price")[]): Promise<void>;
  takePending(id: string, kind: "content" | "stock" | "price", limit: number): Promise<string[]>;
  dropPending(id: string, kind: "content" | "stock" | "price", variantIds: string[]): Promise<void>;
  snapshots(variantIds: string[], siteUrl: string): Promise<VariantSnapshot[]>;
  listingStates(id: string, variantIds: string[]): Promise<Map<string, { status: string; contentId: number | null; contentHash: string | null; priceStockHash: string | null }>>;
  markListings(id: string, rows: { variantId: string; status?: string; contentId?: number | null; lastError?: string | null; contentHash?: string; priceStockHash?: string; batchId?: string }[], now: string): Promise<void>;
  submittedBarcodes(id: string, limit: number): Promise<{ variantId: string; barcode: string }[]>;
  insertBatch(b: { id: string; connectionId: string; kind: "content" | "stock" | "price"; variantIds: string[] }): Promise<void>;
  openBatches(id: string, limit: number): Promise<{ id: string; kind: string; variantIds: string[] }[]>;
  closeBatch(batchId: string, status: "completed" | "failed", failed: number, now: string): Promise<void>;

  // orders
  orderLog(id: string, status: string | null, limit: number): Promise<MarketplaceOrderRow[]>;
}

export interface ImportLine {
  variantId: string;
  sku: string;
  name: string;
  label: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  vatBps: number;
}

/** SQL side of marketplace order import. */
export interface MarketplaceOrderWriter {
  existing(connectionId: string, packageId: string): Promise<{ status: string; order_id: string | null; external_status: string | null; attempts: number } | null>;
  matchVariants(lines: MarketplacePackage["lines"]): Promise<Map<string, { variantId: string; sku: string }>>;
  recordStatement(connectionId: string, p: MarketplacePackage, r: { status: "imported" | "failed" | "skipped"; error: string | null; orderId: string | null }, now: string): Statement;
  statusNoteStatements(connectionId: string, orderId: string, p: MarketplacePackage, label: string, now: string, eventId: string): Statement[];
  importStatements(o: {
    connectionId: string; provider: MarketplaceProvider; label: string; cartId: string; pkg: MarketplacePackage; lines: ImportLine[];
    status: "paid" | "shipped" | "delivered"; withStock: boolean; ids: { session: string; order: string; orderNumber: string; newId: () => string }; now: string;
  }): Statement[];
}

