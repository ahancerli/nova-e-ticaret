import { UnitOfWork, decryptSecret, encryptSecret, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { MessageBus } from "@/modules/messaging";
import type { Actor } from "@/modules/shared/actor";
import { MarketplaceErrors } from "../domain/errors";
import { MARKETPLACES, type ConnectionRow, type ConnectionStats } from "../domain/marketplace";
import type { ClientFactory, ConnectionWrite, Credentials, MarketplaceClient, MarketplaceRepository } from "./ports";
import type { MarketplaceSync, SyncReport, SyncTask } from "./sync";

export interface ConnectionDeps {
  db: Database;
  repo: MarketplaceRepository;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
  masterKey: string;
  factory: ClientFactory;
}

const WEEK_MS = 7 * 86_400_000;

/** Opens the sealed API keys of a connection and builds its marketplace client. */
export async function clientFor(deps: Pick<ConnectionDeps, "repo" | "masterKey" | "factory">, c: ConnectionRow): Promise<MarketplaceClient> {
  if (!MARKETPLACES[c.provider].ready) throw MarketplaceErrors.notReady();
  const sealed = await deps.repo.sealed(c.id);
  if (!sealed) throw MarketplaceErrors.notFound();
  if (!deps.masterKey) throw MarketplaceErrors.masterKeyMissing();
  const creds = JSON.parse(await decryptSecret(deps.masterKey, sealed)) as Credentials;
  return deps.factory({ provider: c.provider, environment: c.environment, sellerId: c.sellerId }, creds);
}

abstract class ConnectionCommand {
  constructor(protected readonly deps: ConnectionDeps) {}

  protected async load(id: string): Promise<ConnectionRow> {
    const c = await this.deps.repo.get(id);
    if (!c) throw MarketplaceErrors.notFound();
    return c;
  }

  protected client(c: ConnectionRow) {
    return clientFor(this.deps, c);
  }
}

/** Query: connections with their counters (panel list). */
export class ListMarketplaceConnections {
  constructor(private readonly repo: MarketplaceRepository) {}
  execute(): Promise<(ConnectionRow & { stats: ConnectionStats })[]> {
    return this.repo.list();
  }
}

export interface ConnectionDetail {
  connection: ConnectionRow;
  stats: ConnectionStats;
  categoryMappings: { categoryId: string; externalCategoryId: number; path: string }[];
  brandMappings: { brandId: string; externalBrandId: number; name: string }[];
  attributeMappings: Awaited<ReturnType<MarketplaceRepository["attributeMappings"]>>;
  valueMappings: Awaited<ReturnType<MarketplaceRepository["valueMappings"]>>;
  bus: { kind: string; ok: boolean; detail: string };
}

export class GetMarketplaceConnection {
  constructor(private readonly repo: MarketplaceRepository, private readonly bus: MessageBus) {}

  async execute(id: string): Promise<ConnectionDetail | null> {
    const connection = await this.repo.get(id);
    if (!connection) return null;
    const [stats, categoryMappings, brandMappings, attributeMappings, valueMappings, bus] = await Promise.all([
      this.repo.stats(id), this.repo.categoryMappings(id), this.repo.brandMappings(id), this.repo.attributeMappings(id), this.repo.valueMappings(id), this.bus.status(),
    ]);
    return { connection, stats, categoryMappings, brandMappings, attributeMappings, valueMappings, bus: { kind: this.bus.kind, ...bus } };
  }
}

/** Command: create / update a connection. API keys are sealed (AES-256-GCM); empty keys on update keep the stored ones. */
export class SaveMarketplaceConnection extends ConnectionCommand {
  async execute(id: string | null, input: ConnectionWrite & { apiKey?: string | null; apiSecret?: string | null; expectedUpdatedAt?: string }, actor: Actor): Promise<{ id: string }> {
    if (!MARKETPLACES[input.provider].ready) throw MarketplaceErrors.notReady();
    const keys = input.apiKey?.trim() && input.apiSecret?.trim() ? { apiKey: input.apiKey.trim(), apiSecret: input.apiSecret.trim() } : null;
    if (!id && !keys) throw MarketplaceErrors.credentialsRequired();
    if (keys && !this.deps.masterKey) throw MarketplaceErrors.masterKeyMissing();
    const sealed = keys ? await encryptSecret(this.deps.masterKey, JSON.stringify(keys)) : null;
    const now = this.deps.clock.nowIso();
    const connId = id ?? this.deps.ids.newId();
    const write: ConnectionWrite = { provider: input.provider, name: input.name.trim(), environment: input.environment, sellerId: input.sellerId.trim(), settings: input.settings, intervals: input.intervals, isActive: input.isActive };
    const uow = new UnitOfWork(this.deps.db);
    if (id) {
      await this.load(id);
      uow.add(this.deps.repo.updateStatement(id, write, sealed, input.expectedUpdatedAt ?? "", now)).expectChanges(1, MarketplaceErrors.changed);
    } else {
      if ((await this.deps.repo.list()).some((c) => c.provider === write.provider && c.environment === write.environment && c.sellerId === write.sellerId)) throw MarketplaceErrors.duplicate();
      uow.add(this.deps.repo.insertStatement(connId, write, sealed!, actor.userId, now));
    }
    await uow.add(this.deps.audit.recordStatement({
      actor, action: id ? "marketplace.update" : "marketplace.create", entityType: "marketplace", entityId: connId,
      diff: { provider: write.provider, name: write.name, sellerId: write.sellerId, environment: write.environment, active: write.isActive, keysChanged: !!keys, intervals: write.intervals },
    })).commit();
    return { id: connId };
  }
}

export class DeleteMarketplaceConnection extends ConnectionCommand {
  async execute(id: string, actor: Actor): Promise<void> {
    const c = await this.load(id);
    await new UnitOfWork(this.deps.db)
      .add(this.deps.repo.deleteStatement(id))
      .add(this.deps.audit.recordStatement({ actor, action: "marketplace.delete", entityType: "marketplace", entityId: id, diff: { name: c.name } }))
      .commit();
  }
}

/** Query: does the marketplace accept the stored keys? */
export class TestMarketplaceConnection extends ConnectionCommand {
  async execute(id: string): Promise<{ ok: true }> {
    await (await this.client(await this.load(id))).test();
    return { ok: true };
  }
}

/** Queries: marketplace reference data for the mapping screens (category tree and attributes cached a week). */
export class MarketplaceReference extends ConnectionCommand {
  async categories(id: string, q: string) {
    const c = await this.load(id);
    const age = await this.deps.repo.categoryCacheAge(c.provider);
    if (!age || this.deps.clock.now().getTime() - new Date(age).getTime() > WEEK_MS) {
      await this.deps.repo.replaceCategoryCache(c.provider, await (await this.client(c)).categoryTree(), this.deps.clock.nowIso());
    }
    return this.deps.repo.cachedCategories(c.provider, q.trim(), 50);
  }

  async attributes(id: string, categoryId: number) {
    const c = await this.load(id);
    const cached = await this.deps.repo.cachedAttributes(c.provider, categoryId);
    if (cached && this.deps.clock.now().getTime() - new Date(cached.fetchedAt).getTime() < WEEK_MS) return cached.payload;
    const fresh = await (await this.client(c)).categoryAttributes(categoryId);
    await this.deps.repo.cacheAttributes(c.provider, categoryId, fresh, this.deps.clock.nowIso());
    return fresh;
  }

  async values(id: string, categoryId: number, attributeId: number) {
    return (await this.client(await this.load(id))).attributeValues(categoryId, attributeId);
  }

  async brands(id: string, q: string) {
    if (q.trim().length < 2) return [];
    return (await this.client(await this.load(id))).brands(q.trim());
  }
}

/** Commands: category / brand / attribute mappings (each change re-queues the listed products' content). */
export class SaveMarketplaceMappings extends ConnectionCommand {
  private async audit(id: string, actor: Actor, diff: unknown) {
    await new UnitOfWork(this.deps.db).add(this.deps.audit.recordStatement({ actor, action: "marketplace.mapping", entityType: "marketplace", entityId: id, diff })).commit();
  }

  async category(id: string, categoryId: string, ext: { id: number; path: string } | null, actor: Actor) {
    await this.load(id);
    await this.deps.repo.setCategoryMapping(id, categoryId, ext);
    await this.deps.repo.enqueueAll(id, ["content"]);
    await this.audit(id, actor, { categoryId, external: ext?.path ?? null });
  }

  async brand(id: string, brandId: string, ext: { id: number; name: string } | null, actor: Actor) {
    await this.load(id);
    await this.deps.repo.setBrandMapping(id, brandId, ext);
    await this.deps.repo.enqueueAll(id, ["content"]);
    await this.audit(id, actor, { brandId, external: ext?.name ?? null });
  }

  async attributes(id: string, externalCategoryId: number, rules: Parameters<MarketplaceRepository["replaceAttributeMappings"]>[2], values: Parameters<MarketplaceRepository["replaceAttributeMappings"]>[3], actor: Actor) {
    await this.load(id);
    await this.deps.repo.replaceAttributeMappings(id, externalCategoryId, rules, values);
    await this.deps.repo.enqueueAll(id, ["content"]);
    await this.audit(id, actor, { externalCategoryId, rules: rules.length, values: values.length });
  }
}

/** Commands + query: which products are sold on the marketplace. */
export class MarketplaceListings extends ConnectionCommand {
  async list(id: string, filter: { status?: string; q?: string }) {
    await this.load(id);
    return this.deps.repo.listings(id, filter, 500);
  }

  async add(id: string, productIds: string[], actor: Actor) {
    await this.load(id);
    const added = await this.deps.repo.addListings(id, productIds);
    await new UnitOfWork(this.deps.db).add(this.deps.audit.recordStatement({ actor, action: "marketplace.listings_add", entityType: "marketplace", entityId: id, diff: { products: productIds.length, variants: added } })).commit();
    return { added };
  }

  async pause(id: string, variantIds: string[], paused: boolean, actor: Actor) {
    await this.load(id);
    await this.deps.repo.setListingsPaused(id, variantIds, paused);
    await new UnitOfWork(this.deps.db).add(this.deps.audit.recordStatement({ actor, action: paused ? "marketplace.listings_pause" : "marketplace.listings_resume", entityType: "marketplace", entityId: id, diff: { variants: variantIds.length } })).commit();
  }

  /** Queue everything again (after changing mappings or settings such as the price adjustment). */
  async resync(id: string, kinds: ("content" | "stock" | "price")[]) {
    await this.load(id);
    await this.deps.repo.enqueueAll(id, kinds);
  }

  async orders(id: string, status: string | null) {
    await this.load(id);
    return this.deps.repo.orderLog(id, status, 200);
  }
}

/** Command: "Şimdi senkronize et" — chosen tasks of one connection now, then the orders that arrived. */
export class RunMarketplaceSync {
  constructor(private readonly sync: MarketplaceSync, private readonly relay: { execute(): Promise<unknown> }) {}

  async execute(id: string, tasks: SyncTask[]): Promise<{ report: SyncReport | null; imported: number; failed: number }> {
    await this.relay.execute();
    await this.sync.consumeCatalog();
    const [report] = await this.sync.run({ connectionId: id, force: tasks });
    const orders = tasks.includes("orders") ? await this.sync.consumeOrders() : { imported: 0, failed: 0 };
    return { report: report ?? null, ...orders };
  }
}

/** Command (cron): relay catalog changes, fan out to connections, run due tasks, import pulled orders. */
export class RunIntegrations {
  constructor(private readonly sync: MarketplaceSync, private readonly relay: { execute(): Promise<{ rows: number; messages: number }> }) {}

  async execute(budgetMs: number) {
    const relayed = await this.relay.execute();
    const queued = await this.sync.consumeCatalog();
    const reports = await this.sync.run({ budgetMs });
    const orders = await this.sync.consumeOrders();
    return { relayed, queued, connections: reports.length, errors: reports.flatMap((r) => r.errors), orders };
  }
}
