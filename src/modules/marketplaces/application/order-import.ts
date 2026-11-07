import { UnitOfWork, databaseErrorCode, isAppError, type Clock, type Database, type IdGenerator, type Logger } from "@/core";
import { MARKETPLACES, orderStatusOf, type MarketplacePackage, type MarketplaceProvider } from "../domain/marketplace";
import type { ImportLine, MarketplaceOrderWriter, MarketplaceRepository } from "./ports";

export type ImportOutcome = "imported" | "status" | "unchanged" | "skipped" | "failed";

/**
 * Command: writes one marketplace package into the order system, exactly once. The package id is the idempotency key
 * (marketplace_orders PK + checkout_sessions.idempotency_key), so overlapping pulls and redelivered bus messages never
 * create a second order. Later statuses of an imported package become order notes. Unknown barcodes leave the package
 * 'failed' (retried on the next delivery after the product is fixed); missing stock does not block the order.
 */
export class ImportMarketplacePackage {
  constructor(private readonly deps: { db: Database; repo: MarketplaceRepository; writer: MarketplaceOrderWriter; ids: IdGenerator; clock: Clock; logger: Logger }) {}

  async execute(connectionId: string, provider: MarketplaceProvider, pkg: MarketplacePackage): Promise<ImportOutcome> {
    const { writer, clock } = this.deps;
    const now = clock.nowIso();
    const label = MARKETPLACES[provider].label;
    const existing = await writer.existing(connectionId, pkg.packageId);
    if (existing?.status === "imported" && existing.order_id) {
      if (existing.external_status === pkg.status) return "unchanged";
      await new UnitOfWork(this.deps.db).add(...writer.statusNoteStatements(connectionId, existing.order_id, pkg, label, now, this.deps.ids.newId())).commit();
      return "status";
    }
    const status = orderStatusOf(pkg.status);
    if (!status) {
      await new UnitOfWork(this.deps.db).add(writer.recordStatement(connectionId, pkg, { status: "skipped", error: `${label} durumu ${pkg.status}: içe aktarılmadı.`, orderId: null }, now)).commit();
      return "skipped";
    }

    const matches = await writer.matchVariants(pkg.lines);
    const unknown: string[] = [];
    const byVariant = new Map<string, ImportLine>();
    for (const l of pkg.lines) {
      const m = (l.barcode && matches.get(`b:${l.barcode}`)) || (l.sku && matches.get(`s:${l.sku.toUpperCase()}`));
      if (!m) { unknown.push(l.barcode ?? l.sku ?? l.name); continue; }
      const prev = byVariant.get(m.variantId);
      if (prev) {
        // the same barcode twice in a package: one line, average unit price
        const quantity = prev.quantity + l.quantity;
        byVariant.set(m.variantId, { ...prev, quantity, unitPriceMinor: Math.round((prev.unitPriceMinor * prev.quantity + l.unitPriceMinor * l.quantity) / quantity), discountMinor: prev.discountMinor + l.discountMinor });
      } else {
        byVariant.set(m.variantId, { variantId: m.variantId, sku: m.sku, name: l.name, label: l.variantLabel, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, discountMinor: l.discountMinor, vatBps: Math.round(l.vatRate * 100) });
      }
    }
    if (unknown.length || !byVariant.size) {
      await new UnitOfWork(this.deps.db).add(writer.recordStatement(connectionId, pkg, {
        status: "failed", error: `Mağazada bulunamayan barkod / SKU: ${unknown.join(", ") || "—"}. Ürünü eşleştirip bekleyin; sipariş sonraki çekişte yeniden denenir.`, orderId: null,
      }, now)).commit();
      return "failed";
    }

    const cartId = await this.deps.repo.ensureChannelCart(connectionId);
    const write = (withStock: boolean) => {
      const order = this.deps.ids.newId();
      return new UnitOfWork(this.deps.db).add(...writer.importStatements({
        connectionId, provider, label, cartId, pkg, lines: [...byVariant.values()], status, withStock, now,
        ids: { session: this.deps.ids.newId(), order, orderNumber: this.deps.ids.newOrderNumber(), newId: () => this.deps.ids.newId() },
      })).commit();
    };
    try {
      await write(true);
      return "imported";
    } catch (e) {
      if ((isAppError(e) ? e.code : databaseErrorCode(e)) === "insufficient_stock") {
        await write(false);
        this.deps.logger.warn("marketplace order imported without stock", { connectionId, packageId: pkg.packageId });
        return "imported";
      }
      // a concurrent consumer imported the same package first
      if ((await writer.existing(connectionId, pkg.packageId))?.status === "imported") return "unchanged";
      throw e;
    }
  }
}
