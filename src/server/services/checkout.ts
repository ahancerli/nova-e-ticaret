import "server-only";
import { getDb, getEnv } from "../db";
import { hmacHex, sha256Hex } from "../crypto";
import { ApiError } from "../http";
import { currentUser } from "../auth";
import { buildQuote } from "./pricing";
import { cartCouponCode, resolveCart } from "./cart";
import { addMinutesIso, newId, newOrderNumber, nowIso } from "@/lib/ids";
import type { Quote } from "@/lib/types";

const RESERVATION_MINUTES = 15;
const BANK_TRANSFER_HOURS = 48;
const WAREHOUSE_ID = "wh_main"; // single warehouse to start (spec D03)

export interface AddressInput {
  recipientName: string; phone: string; province: string; district: string; line1: string; line2?: string; postalCode?: string;
  companyName?: string; taxOffice?: string;
}

/** Deterministic hash of what the customer was shown; confirm must match it. */
async function quoteHash(q: Quote) {
  const canonical = JSON.stringify({
    l: q.lines.map((l) => [l.variantId, l.quantity, l.unitPriceMinor, l.discountMinor]),
    s: q.shippingMinor, t: q.totalMinor, c: q.couponCode,
  });
  return sha256Hex(canonical);
}

/** POST /api/checkout/quote → server totals + a short-lived checkout session. */
export async function createQuote(): Promise<{ checkoutId: string; quote: Quote; expiresAt: string }> {
  const cart = await resolveCart({ create: false });
  if (!cart) throw new ApiError(404, "cart_empty", "Sepetiniz boş.");
  const quote = await buildQuote(cart.id, await cartCouponCode(cart.id));
  if (!quote.lines.length) throw new ApiError(409, "cart_empty", "Sepetinizde satın alınabilir ürün yok.");

  const user = await currentUser();
  const db = await getDb();
  const id = newId();
  const expiresAt = addMinutesIso(RESERVATION_MINUTES);
  await db.batch([
    // Older open quotes for this cart are superseded.
    db.prepare("UPDATE checkout_sessions SET status = 'cancelled', updated_at = ? WHERE cart_id = ? AND status = 'open'").bind(nowIso(), cart.id),
    db.prepare(`INSERT INTO checkout_sessions (id, cart_id, user_id, quote_hash, quote_json, cart_version, total_minor, expires_at, idempotency_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, cart.id, user?.id ?? null, await quoteHash(quote), JSON.stringify(quote), cart.version, quote.totalMinor, expiresAt, `quote:${id}`),
  ]);
  return { checkoutId: id, quote, expiresAt };
}

export interface ConfirmInput {
  checkoutId: string;
  paymentMethod: "iyzico" | "bank_transfer";
  email: string;
  phone: string;
  shipping: AddressInput;
  billing?: AddressInput;
  note?: string;
  acceptedTermsVersion: string;
}

/**
 * POST /api/checkout/confirm.
 * Re-prices on the server, then writes EVERYTHING in one D1 batch (= one transaction):
 * stock reservations (trigger-checked), campaign allocations, coupon redemption,
 * order + snapshots, payment attempt, events and outbox. Any RAISE rolls back the whole batch.
 * External payment calls happen after the batch, never inside it.
 */
export async function confirmCheckout(input: ConfirmInput) {
  const db = await getDb();
  const env = await getEnv();
  const cart = await resolveCart({ create: false });
  if (!cart) throw new ApiError(404, "cart_empty", "Sepetiniz boş.");

  const session = await db
    .prepare("SELECT id, quote_hash, cart_version, status, expires_at, user_id FROM checkout_sessions WHERE id = ? AND cart_id = ?")
    .bind(input.checkoutId, cart.id)
    .first<{ id: string; quote_hash: string; cart_version: number; status: string; expires_at: string; user_id: string | null }>();
  if (!session) throw new ApiError(404, "checkout_not_found", "Ödeme oturumu bulunamadı.");
  if (session.status === "confirmed") throw new ApiError(409, "already_confirmed", "Bu sipariş zaten oluşturuldu.");
  if (session.status !== "open" || session.expires_at <= nowIso()) throw new ApiError(409, "checkout_expired", "Ödeme süresi doldu. Sepeti yeniden onaylayın.");
  if (session.cart_version !== cart.version) throw new ApiError(409, "cart_changed", "Sepetiniz değişti. Tutarları yeniden kontrol edin.");

  const quote = await buildQuote(cart.id, await cartCouponCode(cart.id));
  if ((await quoteHash(quote)) !== session.quote_hash) {
    throw new ApiError(409, "quote_changed", "Fiyat veya stok değişti. Güncel tutarı onaylayın.");
  }

  const config = await db
    .prepare("SELECT id FROM payment_configs WHERE provider = ? AND is_active = 1 LIMIT 1")
    .bind(input.paymentMethod)
    .first<{ id: string }>();
  if (!config) throw new ApiError(422, "payment_method_unavailable", "Seçilen ödeme yöntemi şu an kullanılamıyor.");

  const user = await currentUser();
  const email = input.email.trim().toLowerCase();
  const customerKey = await hmacHex(env.SESSION_SECRET, `customer:${user?.id ?? email}`);
  const orderId = newId();
  const orderNumber = newOrderNumber();
  const paymentId = newId();
  const now = nowIso();
  const reservationExpiry = input.paymentMethod === "bank_transfer" ? addMinutesIso(BANK_TRANSFER_HOURS * 60) : addMinutesIso(RESERVATION_MINUTES);

  const stmts: D1PreparedStatement[] = [];

  // 1) mark checkout confirmed (guarded: only if still open → protects against double submit)
  stmts.push(db.prepare("UPDATE checkout_sessions SET status = 'confirmed', updated_at = ? WHERE id = ? AND status = 'open'").bind(now, session.id));

  // 2) order header (CHECK enforces total = subtotal - discount + shipping)
  stmts.push(
    db.prepare(`INSERT INTO orders (id, order_number, checkout_id, user_id, customer_email, customer_phone, status, payment_status,
                                    subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor, customer_note, placed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(orderId, orderNumber, session.id, user?.id ?? null, email, input.phone,
        input.paymentMethod === "bank_transfer" ? "awaiting_transfer" : "pending_payment",
        quote.subtotalMinor, quote.discountMinor, quote.shippingMinor, quote.taxMinor, quote.totalMinor, input.note ?? null, now),
  );

  // 3) address snapshots
  const addr = (kind: "shipping" | "billing", a: AddressInput) =>
    db.prepare(`INSERT INTO order_addresses (id, order_id, kind, recipient_name, phone_e164, country_code, province, district, line1, line2, postal_code, company_name, tax_office)
                VALUES (?, ?, ?, ?, ?, 'TR', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(newId(), orderId, kind, a.recipientName, a.phone, a.province, a.district, a.line1, a.line2 ?? null, a.postalCode ?? null, a.companyName ?? null, a.taxOffice ?? null);
  stmts.push(addr("shipping", input.shipping), addr("billing", input.billing ?? input.shipping));

  // 4) items + stock reservations (trigger raises insufficient_stock → whole batch rolls back)
  const itemIds = new Map<string, string>();
  for (const l of quote.lines) {
    const itemId = newId();
    itemIds.set(l.variantId, itemId);
    stmts.push(
      db.prepare(`INSERT INTO order_items (id, order_id, variant_id, sku_snapshot, product_name_snapshot, variant_snapshot_json,
                                           quantity, unit_price_minor, subtotal_minor, discount_minor, tax_rate_bps, tax_minor, total_minor)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(itemId, orderId, l.variantId, l.sku, l.productName, JSON.stringify({ label: l.variantLabel }),
          l.quantity, l.unitPriceMinor, l.subtotalMinor, l.discountMinor, l.taxRateBps, l.taxMinor, l.totalMinor),
      db.prepare(`INSERT INTO stock_reservations (id, checkout_id, order_id, variant_id, warehouse_id, quantity, expires_at, idempotency_key)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(newId(), session.id, orderId, l.variantId, WAREHOUSE_ID, l.quantity, reservationExpiry, `res:${session.id}:${l.variantId}`),
      db.prepare(`INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, idempotency_key)
                  VALUES (?, ?, ?, 'reserve', 0, ?, 'order', ?, ?)`)
        .bind(newId(), l.variantId, WAREHOUSE_ID, l.quantity, orderId, `mv:reserve:${session.id}:${l.variantId}`),
    );
  }

  // 5) discounts: per-line adjustments + capacity allocations (trigger-checked)
  const perCampaign = new Map<string, { units: number; amount: number }>();
  for (const a of quote.adjustments) {
    stmts.push(
      db.prepare(`INSERT INTO order_adjustments (id, order_id, order_item_id, campaign_id, coupon_id, label_snapshot, rule_snapshot_json, amount_minor, target)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(newId(), orderId, a.lineVariantId ? itemIds.get(a.lineVariantId) ?? null : null, a.campaignId, a.couponId, a.label, JSON.stringify(a.rule), a.amountMinor, a.target),
    );
    if (a.campaignId) {
      const agg = perCampaign.get(a.campaignId) ?? { units: 0, amount: 0 };
      agg.units = Math.max(agg.units, a.units);
      agg.amount += a.amountMinor;
      perCampaign.set(a.campaignId, agg);
    }
  }
  for (const [campaignId, agg] of perCampaign) {
    stmts.push(
      db.prepare(`INSERT INTO campaign_allocations (id, campaign_id, checkout_id, order_id, units, discount_minor, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(newId(), campaignId, session.id, orderId, Math.max(1, agg.units), agg.amount, reservationExpiry),
    );
  }
  const couponAdj = quote.adjustments.find((a) => a.couponId);
  if (couponAdj?.couponId) {
    stmts.push(
      db.prepare(`INSERT INTO coupon_redemptions (id, coupon_id, checkout_id, order_id, customer_key_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(newId(), couponAdj.couponId, session.id, orderId, customerKey, reservationExpiry),
    );
  }

  // 6) payment attempt (+ bank transfer instruction)
  stmts.push(
    db.prepare(`INSERT INTO payments (id, order_id, payment_config_id, provider, conversation_id, idempotency_key, amount_minor, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`)
      .bind(paymentId, orderId, config.id, input.paymentMethod, orderNumber, `pay:${session.id}`, quote.totalMinor),
  );
  if (input.paymentMethod === "bank_transfer") {
    stmts.push(
      db.prepare(`INSERT INTO bank_transfers (id, payment_id, bank_account_id, reference_code, expected_minor, expires_at)
                  SELECT ?, ?, id, ?, ?, ? FROM bank_accounts WHERE payment_config_id = ? AND is_active = 1 ORDER BY id LIMIT 1`)
        .bind(newId(), paymentId, orderNumber, quote.totalMinor, reservationExpiry, config.id),
    );
  }

  // 7) consent + history + outbox + close cart
  stmts.push(
    db.prepare(`INSERT INTO user_consents (id, user_id, guest_identity_hash, purpose, document_version, granted, recorded_at) VALUES (?, ?, ?, 'distance_sales', ?, 1, ?)`)
      .bind(newId(), user?.id ?? null, user ? null : customerKey, input.acceptedTermsVersion, now),
    db.prepare(`INSERT INTO order_events (id, order_id, event_type, to_status, idempotency_key) VALUES (?, ?, 'placed', ?, ?)`)
      .bind(newId(), orderId, input.paymentMethod === "bank_transfer" ? "awaiting_transfer" : "pending_payment", `evt:placed:${orderId}`),
    db.prepare(`INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES (?, 'order', ?, 'order.placed', ?, ?)`)
      .bind(newId(), orderId, JSON.stringify({ orderNumber, paymentMethod: input.paymentMethod }), `order.placed:${orderId}`),
    db.prepare("UPDATE carts SET status = 'converted', updated_at = ? WHERE id = ?").bind(now, cart.id),
  );

  const results = await db.batch(stmts);
  if ((results[0]?.meta.changes ?? 0) !== 1) {
    // Another request confirmed the same checkout between our read and the batch.
    throw new ApiError(409, "already_confirmed", "Bu sipariş zaten oluşturuldu.");
  }
  return { orderId, orderNumber, paymentId, totalMinor: quote.totalMinor, paymentMethod: input.paymentMethod };
}

/**
 * Settles a successful, provider-verified payment: paid + commit reservations/allocations/coupons.
 * Idempotent: only acts when the payment is not already paid.
 */
export async function markPaymentPaid(paymentId: string, providerPaymentId: string | null, actorId: string | null) {
  const db = await getDb();
  const pay = await db.prepare("SELECT p.order_id, p.status, o.checkout_id FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ?")
    .bind(paymentId).first<{ order_id: string; status: string; checkout_id: string }>();
  if (!pay) throw new ApiError(404, "payment_not_found", "Ödeme bulunamadı.");
  if (pay.status === "paid") return { alreadyPaid: true };
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE payments SET status = 'paid', paid_at = ?, provider_payment_id = COALESCE(?, provider_payment_id), updated_at = ? WHERE id = ? AND status <> 'paid'")
      .bind(now, providerPaymentId, now, paymentId),
    db.prepare("UPDATE orders SET status = 'paid', payment_status = 'paid', updated_at = ? WHERE id = ?").bind(now, pay.order_id),
    db.prepare("UPDATE stock_reservations SET status = 'committed', updated_at = ? WHERE checkout_id = ? AND status = 'reserved'").bind(now, pay.checkout_id),
    db.prepare(`INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, idempotency_key)
                SELECT lower(hex(randomblob(16))), variant_id, warehouse_id, 'commit', -quantity, -quantity, 'order', ?, 'mv:commit:' || id
                  FROM stock_reservations WHERE checkout_id = ? AND status = 'committed'
                ON CONFLICT(idempotency_key) DO NOTHING`).bind(pay.order_id, pay.checkout_id),
    db.prepare("UPDATE campaign_allocations SET status = 'committed' WHERE checkout_id = ? AND status = 'reserved'").bind(pay.checkout_id),
    db.prepare("UPDATE coupon_redemptions SET status = 'committed' WHERE checkout_id = ? AND status = 'reserved'").bind(pay.checkout_id),
    db.prepare("INSERT INTO order_events (id, order_id, event_type, from_status, to_status, actor_id, idempotency_key) VALUES (?, ?, 'payment_captured', NULL, 'paid', ?, ?) ON CONFLICT(idempotency_key) DO NOTHING")
      .bind(newId(), pay.order_id, actorId, `evt:paid:${pay.order_id}`),
    db.prepare("INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload_json, dedupe_key) VALUES (?, 'order', ?, 'order.paid', '{}', ?) ON CONFLICT(dedupe_key) DO NOTHING")
      .bind(newId(), pay.order_id, `order.paid:${pay.order_id}`),
  ]);
  return { alreadyPaid: false };
}

/** Cron: releases expired reservations/allocations/coupons and cancels unpaid orders. */
export async function expireStaleCheckouts() {
  const db = await getDb();
  const now = nowIso();
  const res = await db.batch([
    db.prepare(`INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, idempotency_key)
                SELECT lower(hex(randomblob(16))), variant_id, warehouse_id, 'release', 0, -quantity, 'checkout', checkout_id, 'mv:expire:' || id
                  FROM stock_reservations WHERE status = 'reserved' AND expires_at <= ?
                ON CONFLICT(idempotency_key) DO NOTHING`).bind(now),
    db.prepare(`UPDATE orders SET status = 'cancelled', payment_status = 'failed', updated_at = ?
                 WHERE status IN ('pending_payment','awaiting_transfer') AND checkout_id IN
                       (SELECT checkout_id FROM stock_reservations WHERE status = 'reserved' AND expires_at <= ?)`).bind(now, now),
    db.prepare("UPDATE stock_reservations SET status = 'expired', updated_at = ? WHERE status = 'reserved' AND expires_at <= ?").bind(now, now),
    db.prepare("UPDATE campaign_allocations SET status = 'expired' WHERE status = 'reserved' AND expires_at <= ?").bind(now),
    db.prepare("UPDATE coupon_redemptions SET status = 'expired' WHERE status = 'reserved' AND expires_at <= ?").bind(now),
    db.prepare("UPDATE checkout_sessions SET status = 'expired', updated_at = ? WHERE status = 'open' AND expires_at <= ?").bind(now, now),
    db.prepare("DELETE FROM rate_limit_buckets WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM idempotency_keys WHERE expires_at <= ?").bind(now),
  ]);
  return { expiredReservations: res[2]?.meta.changes ?? 0, cancelledOrders: res[1]?.meta.changes ?? 0 };
}
