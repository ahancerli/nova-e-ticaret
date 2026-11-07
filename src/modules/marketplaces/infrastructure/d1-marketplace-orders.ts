import { Repository, chunk, placeholders, type Statement } from "@/core";
import { includedTaxMinor } from "@/lib/money";
import { DEFAULT_WAREHOUSE } from "@/modules/catalog/domain/product";
import type { MarketplacePackage, MarketplaceProvider } from "../domain/marketplace";

import type { ImportLine, MarketplaceOrderWriter } from "../application/ports";

/** SQL side of writing marketplace packages into the order system (orders → checkout_sessions → channel cart). */
export class D1MarketplaceOrderWriter extends Repository implements MarketplaceOrderWriter {
  async existing(connectionId: string, packageId: string) {
    return this.db.first<{ status: string; order_id: string | null; external_status: string | null; attempts: number }>(
      "SELECT status, order_id, external_status, attempts FROM marketplace_orders WHERE connection_id = ? AND external_package_id = ?", connectionId, packageId,
    );
  }

  /** Barcode first, then SKU (the marketplace's merchantSku / stockCode). */
  async matchVariants(lines: MarketplacePackage["lines"]): Promise<Map<string, { variantId: string; sku: string }>> {
    const out = new Map<string, { variantId: string; sku: string }>();
    const barcodes = lines.map((l) => l.barcode).filter((b): b is string => !!b);
    const skus = lines.map((l) => l.sku?.toUpperCase()).filter((s): s is string => !!s);
    for (const part of chunk(barcodes, 80)) {
      for (const r of await this.db.all<{ id: string; sku: string; barcode: string }>(`SELECT id, sku, barcode FROM product_variants WHERE barcode IN (${placeholders(part.length)})`, ...part)) {
        out.set(`b:${r.barcode}`, { variantId: r.id, sku: r.sku });
      }
    }
    for (const part of chunk(skus, 80)) {
      for (const r of await this.db.all<{ id: string; sku: string }>(`SELECT id, sku FROM product_variants WHERE sku IN (${placeholders(part.length)})`, ...part)) {
        out.set(`s:${r.sku}`, { variantId: r.id, sku: r.sku });
      }
    }
    return out;
  }

  recordStatement(connectionId: string, p: MarketplacePackage, r: { status: "imported" | "failed" | "skipped"; error: string | null; orderId: string | null }, now: string): Statement {
    return this.db.statement(
      `INSERT INTO marketplace_orders (connection_id, external_package_id, external_order_number, order_id, external_status, status, error, last_modified_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (connection_id, external_package_id) DO UPDATE SET order_id = COALESCE(excluded.order_id, marketplace_orders.order_id),
              external_status = excluded.external_status, status = excluded.status, error = excluded.error, last_modified_ms = excluded.last_modified_ms,
              attempts = marketplace_orders.attempts + 1, updated_at = excluded.updated_at`,
      connectionId, p.packageId, p.orderNumber, r.orderId, p.status.slice(0, 40), r.status, r.error?.slice(0, 1000) ?? null, p.lastModifiedMs || null, now, now,
    );
  }

  /** A later status of an imported package (shipped, delivered, cancelled …) as an order event note. */
  statusNoteStatements(connectionId: string, orderId: string, p: MarketplacePackage, label: string, now: string, eventId: string): Statement[] {
    return [
      this.db.statement(
        `INSERT INTO order_events (id, order_id, event_type, note, idempotency_key) VALUES (?, ?, 'marketplace_status', ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`,
        eventId, orderId, `${label} durumu: ${p.status}${p.cargoTrackingNumber ? ` · kargo takip ${p.cargoTrackingNumber}` : ""}`, `evt:mp:${connectionId}:${p.packageId}:${p.status}`,
      ),
      this.recordStatement(connectionId, p, { status: "imported", error: null, orderId }, now),
    ];
  }

  importStatements(o: {
    connectionId: string; provider: MarketplaceProvider; label: string; cartId: string; pkg: MarketplacePackage; lines: ImportLine[];
    status: "paid" | "shipped" | "delivered"; withStock: boolean; ids: { session: string; order: string; orderNumber: string; newId: () => string }; now: string;
  }): Statement[] {
    const { pkg, lines, ids } = o;
    const st = (sql: string, ...p: unknown[]) => this.db.statement(sql, ...p);
    const items = lines.map((l) => {
      const subtotal = l.unitPriceMinor * l.quantity;
      const discount = Math.min(subtotal, Math.max(0, l.discountMinor));
      const total = subtotal - discount;
      return { ...l, subtotal, discount, total, tax: includedTaxMinor(total, l.vatBps) };
    });
    const subtotal = items.reduce((a, i) => a + i.subtotal, 0);
    const discount = items.reduce((a, i) => a + i.discount, 0);
    const total = subtotal - discount;
    const tax = Math.min(total, items.reduce((a, i) => a + i.tax, 0));
    const placedAt = pkg.orderDateMs ? new Date(pkg.orderDateMs).toISOString() : o.now;
    const email = pkg.customer.email || `${o.provider}-${pkg.orderNumber}@marketplace.invalid`;
    const phone = pkg.shipping.phone && /^\+?\d{10,15}$/.test(pkg.shipping.phone.replace(/\s/g, "")) ? pkg.shipping.phone.replace(/\s/g, "") : "+90";

    const out: Statement[] = [
      st(`INSERT INTO checkout_sessions (id, cart_id, quote_hash, quote_json, cart_version, total_minor, status, expires_at, idempotency_key)
          VALUES (?, ?, 'marketplace', '{}', 0, ?, 'confirmed', ?, ?)`, ids.session, o.cartId, total, o.now, `mp:${o.connectionId}:${pkg.packageId}`),
      st(`INSERT INTO orders (id, order_number, checkout_id, customer_email, customer_phone, status, payment_status, subtotal_minor, discount_minor, shipping_minor,
                              tax_minor, total_minor, customer_note, placed_at, sales_channel, external_order_number)
          VALUES (?, ?, ?, ?, ?, ?, 'paid', ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        ids.order, ids.orderNumber, ids.session, email.slice(0, 254), phone, o.status, subtotal, discount, tax, total,
        `${o.label} siparişi ${pkg.orderNumber} (paket ${pkg.packageId})`, placedAt, o.provider, pkg.orderNumber.slice(0, 60)),
    ];
    for (const i of items) {
      out.push(st(
        `INSERT INTO order_items (id, order_id, variant_id, sku_snapshot, product_name_snapshot, variant_snapshot_json, quantity, unit_price_minor, subtotal_minor,
                                  discount_minor, tax_rate_bps, tax_minor, total_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ids.newId(), ids.order, i.variantId, i.sku, i.name.slice(0, 300), JSON.stringify({ label: i.label }), i.quantity, i.unitPriceMinor, i.subtotal, i.discount, i.vatBps, i.tax, i.total,
      ));
    }
    const s = pkg.shipping;
    out.push(st(
      `INSERT INTO order_addresses (id, order_id, kind, recipient_name, phone_e164, country_code, province, district, line1, postal_code)
       VALUES (?, ?, 'shipping', ?, ?, 'TR', ?, ?, ?, ?)`,
      ids.newId(), ids.order, (s.name || pkg.customer.name || "—").slice(0, 200), phone, s.city || "—", s.district || "—", (s.line || "—").slice(0, 500), s.postalCode,
    ));
    if (pkg.billing) {
      const b = pkg.billing;
      out.push(st(
        `INSERT INTO order_addresses (id, order_id, kind, recipient_name, phone_e164, country_code, province, district, line1, company_name, tax_office)
         VALUES (?, ?, 'billing', ?, ?, 'TR', ?, ?, ?, ?, ?)`,
        ids.newId(), ids.order, (b.name || s.name || "—").slice(0, 200), phone, b.city || s.city || "—", b.district || s.district || "—", (b.line || s.line || "—").slice(0, 500), b.company, b.taxOffice,
      ));
    }
    if (o.withStock) {
      // reserve (trigger checks availability) and commit at once: the marketplace already sold the units
      for (const i of items) {
        const resId = ids.newId();
        out.push(
          st(`INSERT INTO stock_reservations (id, checkout_id, order_id, variant_id, warehouse_id, quantity, status, expires_at, idempotency_key)
              VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`, resId, ids.session, ids.order, i.variantId, DEFAULT_WAREHOUSE, i.quantity, o.now, `mpres:${o.connectionId}:${pkg.packageId}:${i.variantId}`),
          st("UPDATE stock_reservations SET status = 'committed', updated_at = ? WHERE id = ?", o.now, resId),
          st(`INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, reason, idempotency_key)
              VALUES (?, ?, ?, 'commit', ?, 0, 'order', ?, ?, ?)`, ids.newId(), i.variantId, DEFAULT_WAREHOUSE, -i.quantity, ids.order, `${o.label} siparişi`, `mv:commit:${resId}`),
        );
      }
    }
    out.push(
      st(`INSERT INTO order_events (id, order_id, event_type, to_status, note, idempotency_key) VALUES (?, ?, 'placed', ?, ?, ?)`,
        ids.newId(), ids.order, o.status,
        `${o.label} siparişi ${pkg.orderNumber} içe aktarıldı.${o.withStock ? "" : " Stok yetersizdi: stok düşülmedi, lütfen stok ve siparişi kontrol edin."}`, `evt:placed:${ids.order}`),
      this.recordStatement(o.connectionId, pkg, { status: "imported", error: null, orderId: ids.order }, o.now),
    );
    return out;
  }
}
