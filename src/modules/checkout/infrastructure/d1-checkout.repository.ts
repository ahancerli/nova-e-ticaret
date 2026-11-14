import { Repository, type Statement } from "@/core";
import type { Quote } from "@/lib/types";
import type { CheckoutRepository, NewOrder, PaymentToSettle } from "../application/ports";
import { PAYABLE_ORDER_STATUSES, WAREHOUSE_ID, type AddressInput, type PaymentMethod } from "../domain/checkout";

const PAYABLE_SQL = PAYABLE_ORDER_STATUSES.map((s) => `'${s}'`).join(",");

export class D1CheckoutRepository extends Repository implements CheckoutRepository {
  async findSession(id: string, cartId: string) {
    const r = await this.db.first<{ id: string; quote_hash: string; cart_version: number; status: string; expires_at: string }>(
      "SELECT id, quote_hash, cart_version, status, expires_at FROM checkout_sessions WHERE id = ? AND cart_id = ?", id, cartId,
    );
    return r ? { id: r.id, quoteHash: r.quote_hash, cartVersion: r.cart_version, status: r.status, expiresAt: r.expires_at } : null;
  }

  async activePaymentConfig(method: PaymentMethod): Promise<string | null> {
    return (await this.db.first<{ id: string }>("SELECT id FROM payment_configs WHERE provider = ? AND is_active = 1 LIMIT 1", method))?.id ?? null;
  }

  openSessionStatements(s: { id: string; cartId: string; userId: string | null; quoteHash: string; quote: Quote; cartVersion: number; expiresAt: string; now: string }): Statement[] {
    return [
      // Older open quotes for this cart are superseded.
      this.db.statement("UPDATE checkout_sessions SET status = 'cancelled', updated_at = ? WHERE cart_id = ? AND status = 'open'", s.now, s.cartId),
      this.db.statement(
        `INSERT INTO checkout_sessions (id, cart_id, user_id, quote_hash, quote_json, cart_version, total_minor, expires_at, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        s.id, s.cartId, s.userId, s.quoteHash, JSON.stringify(s.quote), s.cartVersion, s.quote.totalMinor, s.expiresAt, `quote:${s.id}`,
      ),
    ];
  }

  confirmSessionStatement(sessionId: string, now: string): Statement {
    return this.db.statement("UPDATE checkout_sessions SET status = 'confirmed', updated_at = ? WHERE id = ? AND status = 'open'", now, sessionId);
  }

  convertCartStatement(cartId: string, version: number, now: string): Statement {
    return this.db.statement("UPDATE carts SET status = 'converted', updated_at = ? WHERE id = ? AND status = 'active' AND version = ?", now, cartId, version);
  }

  orderStatements(o: NewOrder, newId: () => string): Statement[] {
    const q = o.quote;
    const st = (sql: string, ...p: unknown[]) => this.db.statement(sql, ...p);
    const out: Statement[] = [];

    // order header (CHECK enforces total = subtotal - discount + shipping)
    out.push(st(
      `INSERT INTO orders (id, order_number, checkout_id, user_id, customer_email, customer_phone, status, payment_status,
                           subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor, customer_note, placed_at, terms_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
      o.orderId, o.orderNumber, o.sessionId, o.userId, o.email, o.phone, o.status,
      q.subtotalMinor, q.discountMinor, q.shippingMinor, q.taxMinor, q.totalMinor, o.note, o.now, o.termsVersion,
    ));

    const address = (kind: "shipping" | "billing", a: AddressInput) => st(
      `INSERT INTO order_addresses (id, order_id, kind, recipient_name, phone_e164, country_code, province, district, line1, line2, postal_code, company_name, tax_office)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(), o.orderId, kind, a.recipientName, a.phone, a.countryCode ?? "TR", a.province, a.district, a.line1, a.line2 ?? null, a.postalCode ?? null, a.companyName ?? null, a.taxOffice ?? null,
    );
    out.push(address("shipping", o.shipping), address("billing", o.billing));

    // items + stock reservations (trigger raises insufficient_stock → whole batch rolls back)
    const itemIds = new Map<string, string>();
    for (const l of q.lines) {
      const itemId = newId();
      itemIds.set(l.variantId, itemId);
      out.push(
        st(`INSERT INTO order_items (id, order_id, variant_id, sku_snapshot, product_name_snapshot, variant_snapshot_json,
                                     quantity, unit_price_minor, subtotal_minor, discount_minor, tax_rate_bps, tax_minor, total_minor)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          itemId, o.orderId, l.variantId, l.sku, l.productName, JSON.stringify({ label: l.variantLabel }),
          l.quantity, l.unitPriceMinor, l.subtotalMinor, l.discountMinor, l.taxRateBps, l.taxMinor, l.totalMinor),
        st(`INSERT INTO stock_reservations (id, checkout_id, order_id, variant_id, warehouse_id, quantity, expires_at, idempotency_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          newId(), o.sessionId, o.orderId, l.variantId, WAREHOUSE_ID, l.quantity, o.reservationExpiresAt, `res:${o.sessionId}:${l.variantId}`),
        st(`INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, idempotency_key)
            VALUES (?, ?, ?, 'reserve', 0, ?, 'order', ?, ?)`,
          newId(), l.variantId, WAREHOUSE_ID, l.quantity, o.orderId, `mv:reserve:${o.sessionId}:${l.variantId}`),
      );
    }

    // discounts: per-line adjustments + capacity allocations (trigger-checked)
    const perCampaign = new Map<string, { units: number; amount: number }>();
    for (const a of q.adjustments) {
      out.push(st(
        `INSERT INTO order_adjustments (id, order_id, order_item_id, campaign_id, coupon_id, label_snapshot, rule_snapshot_json, amount_minor, target)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(), o.orderId, a.lineVariantId ? itemIds.get(a.lineVariantId) ?? null : null, a.campaignId, a.couponId, a.label, JSON.stringify(a.rule), a.amountMinor, a.target,
      ));
      if (a.campaignId) {
        const agg = perCampaign.get(a.campaignId) ?? { units: 0, amount: 0 };
        agg.units = Math.max(agg.units, a.units);
        agg.amount += a.amountMinor;
        perCampaign.set(a.campaignId, agg);
      }
    }
    for (const [campaignId, agg] of perCampaign) {
      out.push(st(
        "INSERT INTO campaign_allocations (id, campaign_id, checkout_id, order_id, units, discount_minor, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        newId(), campaignId, o.sessionId, o.orderId, Math.max(1, agg.units), agg.amount, o.reservationExpiresAt,
      ));
    }
    const couponId = q.adjustments.find((a) => a.couponId)?.couponId;
    if (couponId) {
      out.push(st(
        "INSERT INTO coupon_redemptions (id, coupon_id, checkout_id, order_id, customer_key_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
        newId(), couponId, o.sessionId, o.orderId, o.customerKey, o.reservationExpiresAt,
      ));
    }

    // payment attempt (+ bank transfer instruction)
    out.push(st(
      `INSERT INTO payments (id, order_id, payment_config_id, provider, conversation_id, idempotency_key, amount_minor, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      o.paymentId, o.orderId, o.paymentConfigId, o.method, o.orderNumber, `pay:${o.sessionId}`, q.totalMinor,
    ));
    if (o.method === "bank_transfer") {
      out.push(st(
        `INSERT INTO bank_transfers (id, payment_id, bank_account_id, reference_code, expected_minor, expires_at)
         SELECT ?, ?, id, ?, ?, ? FROM bank_accounts WHERE payment_config_id = ? AND is_active = 1 ORDER BY id LIMIT 1`,
        newId(), o.paymentId, o.orderNumber, q.totalMinor, o.reservationExpiresAt, o.paymentConfigId,
      ));
    }

    // consent + history + outbox
    out.push(
      st("INSERT INTO user_consents (id, user_id, guest_identity_hash, purpose, document_version, granted, recorded_at) VALUES (?, ?, ?, 'distance_sales', ?, 1, ?)",
        newId(), o.userId, o.userId ? null : o.customerKey, o.termsVersion, o.now),
      st("INSERT INTO order_events (id, order_id, event_type, to_status, idempotency_key) VALUES (?, ?, 'placed', ?, ?)",
        newId(), o.orderId, o.status, `evt:placed:${o.orderId}`),
      st("INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES (?, 'order', ?, 'order.placed', ?, ?)",
        newId(), o.orderId, JSON.stringify({ orderNumber: o.orderNumber, paymentMethod: o.method }), `order.placed:${o.orderId}`),
    );
    return out;
  }

  // --- payment settlement --------------------------------------------------------------------------
  async paymentToSettle(paymentId: string): Promise<PaymentToSettle | null> {
    const r = await this.db.first<{ order_id: string; status: string; checkout_id: string; order_status: string; held: number }>(
      `SELECT p.order_id, p.status, o.checkout_id, o.status AS order_status,
              (SELECT COUNT(*) FROM stock_reservations r WHERE r.checkout_id = o.checkout_id AND r.status = 'reserved') AS held
         FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ?`,
      paymentId,
    );
    return r ? { paymentId, orderId: r.order_id, checkoutId: r.checkout_id, paymentStatus: r.status, orderStatus: r.order_status, heldReservations: Number(r.held) } : null;
  }

  markPaymentPaidStatement(paymentId: string, providerPaymentId: string | null, now: string): Statement {
    return this.db.statement(
      `UPDATE payments SET status = 'paid', paid_at = ?, provider_payment_id = COALESCE(?, provider_payment_id), updated_at = ?
        WHERE id = ? AND status NOT IN ('paid','partially_refunded','refunded')`,
      now, providerPaymentId, now, paymentId,
    );
  }

  markOrderPaidStatement(orderId: string, now: string): Statement {
    return this.db.statement(`UPDATE orders SET status = 'paid', payment_status = 'paid', updated_at = ? WHERE id = ? AND status IN (${PAYABLE_SQL})`, now, orderId);
  }

  commitReservationsStatement(checkoutId: string, now: string): Statement {
    return this.db.statement("UPDATE stock_reservations SET status = 'committed', updated_at = ? WHERE checkout_id = ? AND status = 'reserved'", now, checkoutId);
  }

  settlementSideEffects(p: { orderId: string; checkoutId: string; actorId: string | null }, newId: () => string): Statement[] {
    const st = (sql: string, ...params: unknown[]) => this.db.statement(sql, ...params);
    return [
      st(`INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, idempotency_key)
          SELECT lower(hex(randomblob(16))), variant_id, warehouse_id, 'commit', -quantity, -quantity, 'order', ?, 'mv:commit:' || id
            FROM stock_reservations WHERE checkout_id = ? AND status = 'committed'
          ON CONFLICT(idempotency_key) DO NOTHING`, p.orderId, p.checkoutId),
      st("UPDATE campaign_allocations SET status = 'committed' WHERE checkout_id = ? AND status = 'reserved'", p.checkoutId),
      st("UPDATE coupon_redemptions SET status = 'committed' WHERE checkout_id = ? AND status = 'reserved'", p.checkoutId),
      st(`INSERT INTO order_events (id, order_id, event_type, from_status, to_status, actor_id, idempotency_key)
          VALUES (?, ?, 'payment_captured', NULL, 'paid', ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`, newId(), p.orderId, p.actorId, `evt:paid:${p.orderId}`),
      st(`INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key)
          VALUES (?, 'order', ?, 'order.paid', '{}', ?) ON CONFLICT(dedupe_key) DO NOTHING`, newId(), p.orderId, `order.paid:${p.orderId}`),
    ];
  }

  latePaymentStatements(p: { orderId: string; actorId: string | null; now: string }, newId: () => string): Statement[] {
    const st = (sql: string, ...params: unknown[]) => this.db.statement(sql, ...params);
    return [
      // Status stays (e.g. cancelled); the money is recorded so it can be refunded from the order page.
      st("UPDATE orders SET payment_status = 'paid', updated_at = ? WHERE id = ?", p.now, p.orderId),
      st(`INSERT INTO order_events (id, order_id, event_type, note, actor_id, idempotency_key)
          VALUES (?, ?, 'payment_captured', ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`,
        newId(), p.orderId, "Ödeme, sipariş iptal edildikten / süresi dolduktan sonra alındı. Stok ayrılmadı; tutarın iade edilmesi gerekiyor.", p.actorId, `evt:late-paid:${p.orderId}`),
      st(`INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key)
          VALUES (?, 'order', ?, 'order.payment_after_cancel', '{}', ?) ON CONFLICT(dedupe_key) DO NOTHING`, newId(), p.orderId, `order.payment_after_cancel:${p.orderId}`),
    ];
  }

  expireStatements(now: string): Statement[] {
    const st = (sql: string, ...params: unknown[]) => this.db.statement(sql, ...params);
    return [
      st(`INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, idempotency_key)
          SELECT lower(hex(randomblob(16))), variant_id, warehouse_id, 'release', 0, -quantity, 'checkout', checkout_id, 'mv:expire:' || id
            FROM stock_reservations WHERE status = 'reserved' AND expires_at <= ?
          ON CONFLICT(idempotency_key) DO NOTHING`, now),
      st(`UPDATE orders SET status = 'cancelled', payment_status = 'failed', updated_at = ?
           WHERE status IN (${PAYABLE_SQL}) AND checkout_id IN
                 (SELECT checkout_id FROM stock_reservations WHERE status = 'reserved' AND expires_at <= ?)`, now, now),
      st("UPDATE stock_reservations SET status = 'expired', updated_at = ? WHERE status = 'reserved' AND expires_at <= ?", now, now),
      st("UPDATE campaign_allocations SET status = 'expired' WHERE status = 'reserved' AND expires_at <= ?", now),
      st("UPDATE coupon_redemptions SET status = 'expired' WHERE status = 'reserved' AND expires_at <= ?", now),
      st("UPDATE checkout_sessions SET status = 'expired', updated_at = ? WHERE status = 'open' AND expires_at <= ?", now, now),
      st("DELETE FROM rate_limit_buckets WHERE expires_at <= ?", now),
      st("DELETE FROM idempotency_keys WHERE expires_at <= ?", now),
    ];
  }
}
