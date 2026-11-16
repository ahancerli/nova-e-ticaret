import { Repository, type Statement } from "@/core";
import { DEFAULT_PRICE_LIST } from "@/modules/catalog/domain/product";
import type { ProductAlertRepository, VariantSnapshot } from "../application/ports";
import type { AlertKind, AlertStatus, DueAlert, MyProductAlert, ProductAlertState } from "../domain/alert";

const AVAILABLE = (variant: string) => `COALESCE((SELECT SUM(ib.on_hand - ib.reserved) FROM inventory_balances ib WHERE ib.variant_id = ${variant}), 0)`;
/** The variant's own photo first (Renk), else the product cover. */
const IMAGE = `(SELECT m.public_url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id AND m.mime_type LIKE 'image/%'
   WHERE pm.product_id = a.product_id AND (pm.variant_id = a.variant_id OR pm.variant_id IS NULL)
   ORDER BY pm.variant_id IS NULL, pm.is_primary DESC, pm.sort_order LIMIT 1)`;
const VARIANT_LABEL = `(SELECT group_concat(d.label || ': ' || ao.label, ', ') FROM variant_options vo
   JOIN attribute_definitions d ON d.id = vo.attribute_id JOIN attribute_options ao ON ao.id = vo.option_id WHERE vo.variant_id = a.variant_id)`;

type MineRaw = {
  id: string; kind: AlertKind; status: AlertStatus; product_name: string; product_slug: string; image_url: string | null; variant_label: string | null;
  baseline_price_minor: number | null; current_price_minor: number | null; notified_price_minor: number | null; available: number; created_at: string; notified_at: string | null;
};
type DueRaw = {
  id: string; kind: AlertKind; email: string; customer_name: string; product_name: string; product_slug: string; image_url: string | null; variant_label: string | null;
  baseline_price_minor: number | null; price_minor: number; attempts: number;
};

export class D1ProductAlertRepository extends Repository implements ProductAlertRepository {
  async variant(variantId: string): Promise<VariantSnapshot | null> {
    const r = await this.db.first<{ product_id: string; price_minor: number | null; available: number }>(
      `SELECT v.product_id, vp.unit_price_minor AS price_minor, ${AVAILABLE("v.id")} AS available
         FROM product_variants v JOIN products p ON p.id = v.product_id
         LEFT JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?
        WHERE v.id = ? AND v.is_active = 1 AND p.status = 'published'`,
      DEFAULT_PRICE_LIST, variantId,
    );
    return r ? { productId: r.product_id, priceMinor: r.price_minor, available: Number(r.available) } : null;
  }

  async activeCount(userId: string): Promise<number> {
    const r = await this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM product_alerts WHERE user_id = ? AND status = 'active'`, userId);
    return Number(r?.n ?? 0);
  }

  findActive(userId: string, variantId: string, kind: AlertKind) {
    return this.db.first<{ id: string }>(`SELECT id FROM product_alerts WHERE user_id = ? AND variant_id = ? AND kind = ? AND status = 'active'`, userId, variantId, kind);
  }

  insertStatement(row: { id: string; kind: AlertKind; userId: string; productId: string; variantId: string; baselinePriceMinor: number | null; now: string }): Statement {
    return this.db.statement(
      `INSERT INTO product_alerts (id, kind, user_id, product_id, variant_id, baseline_price_minor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.kind, row.userId, row.productId, row.variantId, row.baselinePriceMinor, row.now, row.now,
    );
  }

  cancelStatement(id: string, userId: string, now: string): Statement {
    return this.db.statement(`UPDATE product_alerts SET status = 'cancelled', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'active'`, now, id, userId);
  }

  async forProduct(userId: string, productId: string): Promise<ProductAlertState[]> {
    const rows = await this.db.all<{ id: string; variant_id: string; kind: AlertKind }>(
      `SELECT id, variant_id, kind FROM product_alerts WHERE user_id = ? AND product_id = ? AND status = 'active'`, userId, productId,
    );
    return rows.map((r) => ({ alertId: r.id, variantId: r.variant_id, kind: r.kind }));
  }

  async mine(userId: string, limit: number): Promise<MyProductAlert[]> {
    const rows = await this.db.all<MineRaw>(
      `SELECT a.id, a.kind, a.status, p.name AS product_name, p.slug AS product_slug, ${IMAGE} AS image_url, ${VARIANT_LABEL} AS variant_label,
              a.baseline_price_minor, vp.unit_price_minor AS current_price_minor, a.notified_price_minor, ${AVAILABLE("a.variant_id")} AS available,
              a.created_at, a.notified_at
         FROM product_alerts a JOIN products p ON p.id = a.product_id
         LEFT JOIN variant_prices vp ON vp.variant_id = a.variant_id AND vp.price_list_id = ?
        WHERE a.user_id = ? AND a.status IN ('active','notified')
        ORDER BY a.status = 'active' DESC, COALESCE(a.notified_at, a.created_at) DESC LIMIT ?`,
      DEFAULT_PRICE_LIST, userId, limit,
    );
    return rows.map((r) => ({
      id: r.id, kind: r.kind, status: r.status, productName: r.product_name, productSlug: r.product_slug, imageUrl: r.image_url, variantLabel: r.variant_label,
      baselinePriceMinor: r.baseline_price_minor, currentPriceMinor: r.current_price_minor, notifiedPriceMinor: r.notified_price_minor,
      available: Math.max(0, Number(r.available)), createdAt: r.created_at, notifiedAt: r.notified_at,
    }));
  }

  /** Both kinds need a sellable unit: a "price dropped" mail for something that cannot be bought would only annoy. */
  async due(now: string, limit: number): Promise<DueAlert[]> {
    const rows = await this.db.all<DueRaw>(
      `SELECT a.id, a.kind, u.email_normalized AS email,
              COALESCE(NULLIF(trim(COALESCE(cp.first_name, '')), ''), u.display_name) AS customer_name,
              p.name AS product_name, p.slug AS product_slug, ${IMAGE} AS image_url, ${VARIANT_LABEL} AS variant_label,
              a.baseline_price_minor, vp.unit_price_minor AS price_minor, a.attempts
         FROM product_alerts a
         JOIN users u ON u.id = a.user_id AND u.status = 'active'
         LEFT JOIN customer_profiles cp ON cp.user_id = a.user_id
         JOIN product_variants v ON v.id = a.variant_id AND v.is_active = 1
         JOIN products p ON p.id = a.product_id AND p.status = 'published'
         JOIN variant_prices vp ON vp.variant_id = a.variant_id AND vp.price_list_id = ?
        WHERE a.status = 'active' AND (a.next_attempt_at IS NULL OR a.next_attempt_at <= ?)
          AND ${AVAILABLE("a.variant_id")} > 0
          AND (a.kind = 'back_in_stock' OR vp.unit_price_minor < a.baseline_price_minor)
        ORDER BY a.created_at, a.id LIMIT ?`,
      DEFAULT_PRICE_LIST, now, limit,
    );
    return rows.map((r) => ({
      id: r.id, kind: r.kind, email: r.email, customerName: r.customer_name, productName: r.product_name, productSlug: r.product_slug, imageUrl: r.image_url,
      variantLabel: r.variant_label, baselinePriceMinor: r.baseline_price_minor, priceMinor: r.price_minor, attempts: r.attempts,
    }));
  }

  notifiedStatement(id: string, priceMinor: number, now: string): Statement {
    return this.db.statement(
      `UPDATE product_alerts SET status = 'notified', notified_price_minor = ?, notified_at = ?, next_attempt_at = NULL, last_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'active'`,
      priceMinor, now, now, id,
    );
  }

  /** `nextAttemptAt` null = give up (failed). */
  failedAttemptStatement(id: string, error: string, nextAttemptAt: string | null, now: string): Statement {
    return this.db.statement(
      `UPDATE product_alerts SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, status = CASE WHEN ? IS NULL THEN 'failed' ELSE status END, updated_at = ?
        WHERE id = ? AND status = 'active'`,
      error.slice(0, 500), nextAttemptAt, nextAttemptAt, now, id,
    );
  }
}
