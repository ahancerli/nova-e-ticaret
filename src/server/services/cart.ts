import "server-only";
import { cookies } from "next/headers";
import { getDb, getEnv } from "../db";
import { hmacHex, randomToken } from "../crypto";
import { ApiError } from "../http";
import { currentUser } from "../auth";
import { addMinutesIso, newId, nowIso } from "@/lib/ids";

export const CART_COOKIE = "__Host-nova_cart";
const GUEST_CART_DAYS = 30;
const MAX_LINE_QTY = 20;

async function guestHash(token: string) {
  const env = await getEnv();
  return hmacHex(env.SESSION_SECRET, `cart:${token}`);
}

export interface CartRef { id: string; version: number; userId: string | null }

/** Resolves the caller's cart from session (member) or cookie (guest). Ownership is implicit in the lookup. */
export async function resolveCart(opts: { create: boolean }): Promise<CartRef | null> {
  const db = await getDb();
  const user = await currentUser();
  if (user) {
    const existing = await db.prepare("SELECT id, version FROM carts WHERE user_id = ? AND status = 'active'").bind(user.id).first<{ id: string; version: number }>();
    if (existing) return { ...existing, userId: user.id };
    if (!opts.create) return null;
    const id = newId();
    await db.prepare("INSERT INTO carts (id, user_id) VALUES (?, ?)").bind(id, user.id).run();
    return { id, version: 0, userId: user.id };
  }

  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value;
  if (token) {
    const row = await db
      .prepare("SELECT id, version FROM carts WHERE guest_token_hash = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)")
      .bind(await guestHash(token), nowIso())
      .first<{ id: string; version: number }>();
    if (row) return { ...row, userId: null };
  }
  if (!opts.create) return null;

  const fresh = randomToken();
  const id = newId();
  const expiresAt = addMinutesIso(GUEST_CART_DAYS * 24 * 60);
  await db.prepare("INSERT INTO carts (id, guest_token_hash, expires_at) VALUES (?, ?, ?)").bind(id, await guestHash(fresh), expiresAt).run();
  jar.set(CART_COOKIE, fresh, { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: new Date(expiresAt) });
  return { id, version: 0, userId: null };
}

async function availableFor(variantId: string): Promise<{ available: number; sellable: boolean }> {
  const db = await getDb();
  const row = await db
    .prepare(`SELECT v.is_active AND p.status = 'published' AS sellable,
                     COALESCE((SELECT SUM(on_hand - reserved) FROM inventory_balances WHERE variant_id = v.id), 0) AS available
                FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`)
    .bind(variantId)
    .first<{ sellable: number; available: number }>();
  if (!row) throw new ApiError(404, "variant_not_found", "Ürün bulunamadı.");
  return { available: row.available, sellable: row.sellable === 1 };
}

const bumpVersion = (db: D1Database, cartId: string) =>
  db.prepare("UPDATE carts SET version = version + 1, updated_at = ? WHERE id = ?").bind(nowIso(), cartId);

export async function addItem(variantId: string, quantity: number) {
  const cart = (await resolveCart({ create: true }))!;
  const db = await getDb();
  const { available, sellable } = await availableFor(variantId);
  if (!sellable) throw new ApiError(409, "not_sellable", "Bu ürün şu an satışta değil.");
  const current = await db.prepare("SELECT quantity FROM cart_items WHERE cart_id = ? AND variant_id = ?").bind(cart.id, variantId).first<{ quantity: number }>();
  const target = (current?.quantity ?? 0) + quantity;
  if (target > Math.min(available, MAX_LINE_QTY)) {
    throw new ApiError(409, "insufficient_stock", `Bu üründen en fazla ${Math.min(available, MAX_LINE_QTY)} adet ekleyebilirsiniz.`);
  }
  await db.batch([
    db.prepare(`INSERT INTO cart_items (id, cart_id, variant_id, quantity) VALUES (?, ?, ?, ?)
                ON CONFLICT(cart_id, variant_id) DO UPDATE SET quantity = excluded.quantity, updated_at = ?`)
      .bind(newId(), cart.id, variantId, target, nowIso()),
    bumpVersion(db, cart.id),
  ]);
  return cart.id;
}

export async function updateItem(itemId: string, quantity: number, expectedVersion?: number) {
  const cart = await resolveCart({ create: false });
  if (!cart) throw new ApiError(404, "cart_not_found", "Sepet bulunamadı.");
  if (expectedVersion != null && expectedVersion !== cart.version) {
    throw new ApiError(409, "cart_version_conflict", "Sepet başka bir sekmede değişti. Lütfen yenileyin.");
  }
  const db = await getDb();
  // Ownership: the item must belong to the caller's cart.
  const item = await db.prepare("SELECT variant_id FROM cart_items WHERE id = ? AND cart_id = ?").bind(itemId, cart.id).first<{ variant_id: string }>();
  if (!item) throw new ApiError(404, "item_not_found", "Sepet satırı bulunamadı.");
  const { available } = await availableFor(item.variant_id);
  if (quantity > Math.min(available, MAX_LINE_QTY)) {
    throw new ApiError(409, "insufficient_stock", `Bu üründen en fazla ${Math.min(available, MAX_LINE_QTY)} adet alabilirsiniz.`);
  }
  await db.batch([
    db.prepare("UPDATE cart_items SET quantity = ?, updated_at = ? WHERE id = ? AND cart_id = ?").bind(quantity, nowIso(), itemId, cart.id),
    bumpVersion(db, cart.id),
  ]);
  return cart.id;
}

export async function removeItem(itemId: string) {
  const cart = await resolveCart({ create: false });
  if (!cart) throw new ApiError(404, "cart_not_found", "Sepet bulunamadı.");
  const db = await getDb();
  await db.batch([db.prepare("DELETE FROM cart_items WHERE id = ? AND cart_id = ?").bind(itemId, cart.id), bumpVersion(db, cart.id)]);
  return cart.id;
}

export async function attachCoupon(cartId: string, couponId: string) {
  const db = await getDb();
  await db.batch([
    db.prepare("DELETE FROM cart_coupons WHERE cart_id = ?").bind(cartId),
    db.prepare("INSERT INTO cart_coupons (cart_id, coupon_id) VALUES (?, ?)").bind(cartId, couponId),
    bumpVersion(db, cartId),
  ]);
}

export async function detachCoupon(cartId: string) {
  const db = await getDb();
  await db.batch([db.prepare("DELETE FROM cart_coupons WHERE cart_id = ?").bind(cartId), bumpVersion(db, cartId)]);
}

export async function cartCouponCode(cartId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db
    .prepare("SELECT c.code_normalized FROM cart_coupons cc JOIN coupons c ON c.id = cc.coupon_id WHERE cc.cart_id = ? LIMIT 1")
    .bind(cartId)
    .first<{ code_normalized: string }>();
  return row?.code_normalized ?? null;
}

/** On login: move guest lines into the member cart, re-checking stock limits (spec §05). */
export async function mergeGuestCartInto(userId: string) {
  const jar = await cookies();
  const token = jar.get(CART_COOKIE)?.value;
  if (!token) return;
  const db = await getDb();
  const guest = await db.prepare("SELECT id FROM carts WHERE guest_token_hash = ? AND status = 'active'").bind(await guestHash(token)).first<{ id: string }>();
  jar.delete(CART_COOKIE);
  if (!guest) return;

  let member = await db.prepare("SELECT id FROM carts WHERE user_id = ? AND status = 'active'").bind(userId).first<{ id: string }>();
  if (!member) {
    member = { id: newId() };
    await db.prepare("INSERT INTO carts (id, user_id) VALUES (?, ?)").bind(member.id, userId).run();
  }
  await db.batch([
    db.prepare(`INSERT INTO cart_items (id, cart_id, variant_id, quantity)
                SELECT lower(hex(randomblob(16))), ?, g.variant_id,
                       MIN(g.quantity + COALESCE(m.quantity, 0), ?,
                           MAX(1, COALESCE((SELECT SUM(on_hand - reserved) FROM inventory_balances ib WHERE ib.variant_id = g.variant_id), 0)))
                  FROM cart_items g LEFT JOIN cart_items m ON m.cart_id = ? AND m.variant_id = g.variant_id
                 WHERE g.cart_id = ?
                ON CONFLICT(cart_id, variant_id) DO UPDATE SET quantity = excluded.quantity, updated_at = ?`)
      .bind(member.id, MAX_LINE_QTY, member.id, guest.id, nowIso()),
    db.prepare("UPDATE carts SET status = 'merged', updated_at = ? WHERE id = ?").bind(nowIso(), guest.id),
    bumpVersion(db, member.id),
  ]);
}
