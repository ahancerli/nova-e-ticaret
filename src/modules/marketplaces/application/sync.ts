import { isAppError, sha256Hex, type Clock, type Logger } from "@/core";
import { TOPICS, topicName, type CatalogChangeMessage, type MessageBus } from "@/modules/messaging";
import { buildTrendyolItem, marketPrices, marketQuantity, type ConnectionRow, type MarketplacePackage, type MarketplaceProvider, type TrendyolItem } from "../domain/marketplace";
import type { ImportMarketplacePackage } from "./order-import";
import type { MarketplaceClient, MarketplaceRepository } from "./ports";

export type SyncTask = "content" | "stock" | "price" | "orders";
export const SYNC_TASKS: SyncTask[] = ["orders", "stock", "price", "content"];

const CATALOG_GROUP = "nova-marketplaces";
const ORDERS_GROUP = "nova-marketplace-orders";
const BATCH = 1000;

export interface OrderMessage {
  connectionId: string;
  provider: MarketplaceProvider;
  pkg: MarketplacePackage;
}

export interface SyncReport {
  connectionId: string;
  ran: SyncTask[];
  content: number;
  stock: number;
  price: number;
  ordersPulled: number;
  errors: string[];
}

const addMinutes = (iso: string, m: number) => new Date(new Date(iso).getTime() + m * 60_000).toISOString();

/**
 * Marketplace synchronisation, driven by the bus:
 *
 *   catalog change (trigger) ─► relay ─► Kafka catalog.* topics ─► consumeCatalog() ─► marketplace_pending (per connection)
 *   every connection, at ITS intervals: content / stock / price pushes from marketplace_pending ─► marketplace REST API
 *   orders: pullOrders() ─► Kafka marketplace.orders ─► consumeOrders() ─► order system (exactly once per package)
 *
 * Pushes read the current catalog state (messages are notifications) and skip what the marketplace already has
 * (hashes), so retries and replays are harmless.
 */
export class MarketplaceSync {
  constructor(private readonly deps: {
    repo: MarketplaceRepository; bus: MessageBus; prefix: string; clientFor: (c: ConnectionRow) => Promise<MarketplaceClient>;
    importer: ImportMarketplacePackage; clock: Clock; logger: Logger; siteUrl: string;
  }) {}

  /** Catalog topics → pending work of every connection that lists the changed products. */
  async consumeCatalog(): Promise<number> {
    let queued = 0;
    const map = [["productInfo", "content"], ["images", "content"], ["stock", "stock"], ["price", "price"]] as const;
    for (const [topic, kind] of map) {
      const batch = await this.deps.bus.poll<CatalogChangeMessage>(CATALOG_GROUP, topicName(this.deps.prefix, topic), 1000);
      if (!batch.records.length) { await batch.commit(); continue; }
      const productIds = new Set<string>(), variantIds = new Set<string>();
      for (const r of batch.records) {
        // product-level content changes (name, category …) touch every variant; stock / price are per variant
        if (kind === "content" || !r.value.variantId) productIds.add(r.value.productId);
        else variantIds.add(r.value.variantId);
      }
      queued += await this.deps.repo.enqueueFromChanges({ kind, productIds: [...productIds], variantIds: [...variantIds] });
      await batch.commit();
    }
    return queued;
  }

  /** Marketplace order packages from the bus → order system. */
  async consumeOrders(): Promise<{ imported: number; failed: number }> {
    const batch = await this.deps.bus.poll<OrderMessage>(ORDERS_GROUP, topicName(this.deps.prefix, "marketplaceOrders"), 200);
    let imported = 0, failed = 0;
    for (const r of batch.records) {
      try {
        const outcome = await this.deps.importer.execute(r.value.connectionId, r.value.provider, r.value.pkg);
        if (outcome === "imported") imported++;
        if (outcome === "failed") failed++;
      } catch (e) {
        failed++;
        // keep going: the package stays unimported and comes again with the next pull (watermark overlap)
        this.deps.logger.error("marketplace order import failed", { packageId: r.value.pkg?.packageId, error: String(e) });
      }
    }
    await batch.commit();
    return { imported, failed };
  }

  /** Due tasks of every active connection (or one connection, forced tasks for "Şimdi senkronize et"). */
  async run(opts: { connectionId?: string; force?: SyncTask[]; budgetMs?: number } = {}): Promise<SyncReport[]> {
    const started = Date.now();
    const conns = opts.connectionId ? [await this.deps.repo.get(opts.connectionId)].filter((c): c is ConnectionRow => !!c) : await this.deps.repo.active();
    const reports: SyncReport[] = [];
    for (const c of conns) {
      if (opts.budgetMs && Date.now() - started > opts.budgetMs) break;
      reports.push(await this.runConnection(c, opts.force));
    }
    return reports;
  }

  private async runConnection(c: ConnectionRow, force?: SyncTask[]): Promise<SyncReport> {
    const now = this.deps.clock.nowIso();
    const report: SyncReport = { connectionId: c.id, ran: [], content: 0, stock: 0, price: 0, ordersPulled: 0, errors: [] };
    let client: MarketplaceClient;
    try {
      client = await this.deps.clientFor(c);
    } catch (e) {
      report.errors.push(isAppError(e) ? e.message : String(e));
      await this.deps.repo.setResult(c.id, { lastError: report.errors[0]! }, now);
      return report;
    }
    const due = (t: SyncTask) => force?.includes(t) || (!force && (!c.next[t] || c.next[t]! <= now));
    const step = async (t: SyncTask, fn: () => Promise<void>) => {
      if (!due(t)) return;
      report.ran.push(t);
      try {
        await fn();
      } catch (e) {
        report.errors.push(`${t}: ${isAppError(e) ? e.message : String(e)}`);
        this.deps.logger.warn("marketplace task failed", { connectionId: c.id, task: t, error: String(e) });
      }
      await this.deps.repo.setNext(c.id, t, addMinutes(now, c.intervals[t]));
    };
    let ordersSyncedUntil: number | undefined;
    await step("orders", async () => { const r = await this.pullOrders(c, client); report.ordersPulled = r.pulled; ordersSyncedUntil = r.watermark; });
    await step("content", async () => { report.content = await this.pushContent(c, client); });
    await step("stock", async () => { report.stock = await this.pushStock(c, client); });
    await step("price", async () => { report.price = await this.pushPrice(c, client); });
    // asynchronous marketplace results and approvals are read on every run (cheap)
    try {
      await this.checkBatches(c, client);
      await this.checkApprovals(c, client);
    } catch (e) {
      report.errors.push(`durum: ${isAppError(e) ? e.message : String(e)}`);
    }
    await this.deps.repo.setResult(c.id, { lastError: report.errors.join(" · ") || null, ...(ordersSyncedUntil !== undefined ? { ordersSyncedUntil } : {}) }, now);
    return report;
  }

  /** New / changed products: create (never sent), update unapproved, or update approved content. */
  async pushContent(c: ConnectionRow, client: MarketplaceClient): Promise<number> {
    const { repo } = this.deps;
    const ids = await repo.takePending(c.id, "content", BATCH);
    if (!ids.length) return 0;
    const [snaps, states, maps] = await Promise.all([repo.snapshots(ids, this.deps.siteUrl), repo.listingStates(c.id, ids), repo.mappings(c.id, c.provider)]);
    const now = this.deps.clock.nowIso();
    const create: { id: string; item: TrendyolItem; hash: string }[] = [], unapproved: typeof create = [], approved: (typeof create[number] & { contentId: number })[] = [];
    const marks: Parameters<MarketplaceRepository["markListings"]>[1] = [];
    for (const v of snaps) {
      const st = states.get(v.variantId);
      if (!st || st.status === "paused") continue;
      const built = buildTrendyolItem(v, maps, c.settings);
      if ("problems" in built) { marks.push({ variantId: v.variantId, status: st.status === "approved" ? "approved" : "error", lastError: built.problems.join(" ") }); continue; }
      // content hash leaves out price and stock: those travel on their own interval
      const hash = await sha256Hex(JSON.stringify({ ...built.item, quantity: 0, salePrice: 0, listPrice: 0 }));
      if (hash === st.contentHash && (st.status === "submitted" || st.status === "approved")) continue;
      const entry = { id: v.variantId, item: built.item, hash };
      if (st.status === "approved" && st.contentId) approved.push({ ...entry, contentId: st.contentId });
      else if (st.status === "submitted") unapproved.push(entry);
      else create.push(entry);
    }
    let sent = 0;
    const send = async (group: typeof create, call: () => Promise<string>, status: string) => {
      if (!group.length) return;
      const batchId = await call();
      await repo.insertBatch({ id: batchId, connectionId: c.id, kind: "content", variantIds: group.map((g) => g.id) });
      marks.push(...group.map((g) => ({ variantId: g.id, status, lastError: null, contentHash: g.hash, batchId })));
      sent += group.length;
    };
    await send(create, () => client.createProducts(create.map((g) => g.item)), "submitted");
    await send(unapproved, () => client.updateUnapproved(unapproved.map((g) => g.item)), "submitted");
    await send(approved, () => client.updateApprovedContent(approved.map((g) => ({ contentId: g.contentId, item: g.item }))), "approved");
    await repo.markListings(c.id, marks, now);
    await repo.dropPending(c.id, "content", ids);
    return sent;
  }

  /** Stock of approved listings (quantity only; paused listings → 0). */
  async pushStock(c: ConnectionRow, client: MarketplaceClient): Promise<number> {
    return this.pushInventory(c, client, "stock");
  }

  /** Prices of approved listings (sale / list price only). */
  async pushPrice(c: ConnectionRow, client: MarketplaceClient): Promise<number> {
    return this.pushInventory(c, client, "price");
  }

  private async pushInventory(c: ConnectionRow, client: MarketplaceClient, kind: "stock" | "price"): Promise<number> {
    const { repo } = this.deps;
    const ids = await repo.takePending(c.id, kind, BATCH);
    if (!ids.length) return 0;
    const [snaps, states] = await Promise.all([repo.snapshots(ids, this.deps.siteUrl), repo.listingStates(c.id, ids)]);
    const items: { id: string; body: { barcode: string; quantity?: number; salePrice?: number; listPrice?: number }; hash: string }[] = [];
    for (const v of snaps) {
      const st = states.get(v.variantId);
      // only products the marketplace approved accept price / stock updates
      if (!st || !st.contentId || !v.barcode) continue;
      const [q, s, l] = (st.priceStockHash ?? "||").split("|");
      if (kind === "stock") {
        const quantity = st.status === "paused" ? 0 : marketQuantity(v, c.settings);
        if (String(quantity) === q) continue;
        items.push({ id: v.variantId, body: { barcode: v.barcode, quantity }, hash: `${quantity}|${s}|${l}` });
      } else {
        const p = marketPrices(v, c.settings);
        if (!p || (String(p.salePrice) === s && String(p.listPrice) === l)) continue;
        items.push({ id: v.variantId, body: { barcode: v.barcode, salePrice: p.salePrice, listPrice: p.listPrice }, hash: `${q}|${p.salePrice}|${p.listPrice}` });
      }
    }
    if (items.length) {
      const batchId = await client.updatePriceStock(items.map((i) => i.body));
      await repo.insertBatch({ id: batchId, connectionId: c.id, kind, variantIds: items.map((i) => i.id) });
      await repo.markListings(c.id, items.map((i) => ({ variantId: i.id, priceStockHash: i.hash, batchId })), this.deps.clock.nowIso());
    }
    await repo.dropPending(c.id, kind, ids);
    return items.length;
  }

  /** Reads finished batches: failed items get their reasons (and are retried after the shop fixes them). */
  async checkBatches(c: ConnectionRow, client: MarketplaceClient): Promise<void> {
    const { repo } = this.deps;
    const now = this.deps.clock.nowIso();
    for (const b of await repo.openBatches(c.id, 10)) {
      const r = await client.batchResult(b.id);
      if (!r.done) continue;
      const snaps = await repo.snapshots(b.variantIds, this.deps.siteUrl);
      const byBarcode = new Map(snaps.filter((s) => s.barcode).map((s) => [s.barcode!, s.variantId]));
      const failed = r.items.filter((i) => !i.ok);
      const marks = failed.map((i) => ({
        variantId: (i.barcode && byBarcode.get(i.barcode)) || "",
        ...(b.kind === "content" ? { status: "error" } : {}),
        lastError: i.reasons.join(" ") || "Pazaryeri kaydı reddetti.",
        // a failed price / stock update is sent again next time
        ...(b.kind !== "content" ? { priceStockHash: "||" } : { contentHash: "" }),
      })).filter((m) => m.variantId);
      await repo.markListings(c.id, marks, now);
      await repo.closeBatch(b.id, "completed", failed.length, now);
    }
  }

  /** Submitted products: approved (content id; then stock and price go out) or rejected (reasons shown). */
  async checkApprovals(c: ConnectionRow, client: MarketplaceClient): Promise<void> {
    const { repo } = this.deps;
    const now = this.deps.clock.nowIso();
    const marks: Parameters<MarketplaceRepository["markListings"]>[1] = [];
    const approvedIds: string[] = [];
    for (const s of await repo.submittedBarcodes(c.id, 20)) {
      const st = await client.productStatus(s.barcode);
      if (!st) continue;
      if (st.approved && st.contentId) { marks.push({ variantId: s.variantId, status: "approved", contentId: st.contentId, lastError: null }); approvedIds.push(s.variantId); }
      else if (st.rejected) marks.push({ variantId: s.variantId, status: "rejected", lastError: st.reasons.join(" ") || "Pazaryeri ürünü reddetti." });
    }
    await repo.markListings(c.id, marks, now);
    if (approvedIds.length) {
      await repo.enqueueFromChanges({ kind: "stock", productIds: [], variantIds: approvedIds });
      await repo.enqueueFromChanges({ kind: "price", productIds: [], variantIds: approvedIds });
    }
  }

  /** Pulls packages changed since the watermark (overlapping by 2 h) and puts them on the bus. */
  async pullOrders(c: ConnectionRow, client: MarketplaceClient): Promise<{ pulled: number; watermark: number }> {
    const nowMs = this.deps.clock.now().getTime();
    const since = c.ordersSyncedUntil ?? nowMs - 7 * 86_400_000;
    const startMs = since - 2 * 3_600_000;
    const endMs = Math.min(nowMs, startMs + 14 * 86_400_000);
    let pulled = 0, page = 0, totalPages = 1, maxSeen = 0;
    for (; page < totalPages && page < 10; page++) {
      const r = await client.orders({ startMs, endMs, page, size: 200 });
      totalPages = r.totalPages;
      if (r.packages.length) {
        await this.deps.bus.publish<OrderMessage>(topicName(this.deps.prefix, "marketplaceOrders"),
          r.packages.map((pkg) => ({ key: `${c.id}:${pkg.packageId}`, value: { connectionId: c.id, provider: c.provider, pkg } })));
        pulled += r.packages.length;
        maxSeen = Math.max(maxSeen, ...r.packages.map((p) => p.lastModifiedMs || 0));
      }
    }
    // all pages read → the window is done; otherwise continue from the newest package seen
    const watermark = page >= totalPages ? endMs : Math.max(since, maxSeen);
    return { pulled, watermark };
  }
}

export { TOPICS };
