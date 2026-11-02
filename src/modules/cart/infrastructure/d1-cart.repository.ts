import { Repository, type Statement } from "@/core";
import type { CartRepository } from "../application/ports";
import { MAX_LINE_QTY } from "../domain/cart";

export class D1CartRepository extends Repository implements CartRepository {
  findMemberCart(userId: string) {
    return this.db.first<{ id: string; version: number }>("SELECT id, version FROM carts WHERE user_id = ? AND status = 'active'", userId);
  }

  findGuestCart(tokenHash: string, now: string) {
    return this.db.first<{ id: string; version: number }>(
      "SELECT id, version FROM carts WHERE guest_token_hash = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)",
      tokenHash, now,
    );
  }

  async createMemberCart(id: string, userId: string): Promise<void> {
    await this.db.run("INSERT INTO carts (id, user_id) VALUES (?, ?)", id, userId);
  }

  async createGuestCart(id: string, tokenHash: string, expiresAt: string): Promise<void> {
    await this.db.run("INSERT INTO carts (id, guest_token_hash, expires_at) VALUES (?, ?, ?)", id, tokenHash, expiresAt);
  }

  async sellability(variantId: string) {
    const r = await this.db.first<{ sellable: number; available: number }>(
      `SELECT v.is_active AND p.status = 'published' AS sellable,
              COALESCE((SELECT SUM(on_hand - reserved) FROM inventory_balances WHERE variant_id = v.id), 0) AS available
         FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = ?`,
      variantId,
    );
    return r ? { sellable: r.sellable === 1, available: r.available } : null;
  }

  async quantityInCart(cartId: string, variantId: string): Promise<number> {
    return (await this.db.first<{ quantity: number }>("SELECT quantity FROM cart_items WHERE cart_id = ? AND variant_id = ?", cartId, variantId))?.quantity ?? 0;
  }

  async lineVariant(cartId: string, itemId: string): Promise<string | null> {
    return (await this.db.first<{ variant_id: string }>("SELECT variant_id FROM cart_items WHERE id = ? AND cart_id = ?", itemId, cartId))?.variant_id ?? null;
  }

  async couponCode(cartId: string): Promise<string | null> {
    return (await this.db.first<{ code_normalized: string }>(
      "SELECT c.code_normalized FROM cart_coupons cc JOIN coupons c ON c.id = cc.coupon_id WHERE cc.cart_id = ? LIMIT 1", cartId,
    ))?.code_normalized ?? null;
  }

  addQuantityStatement(cartId: string, variantId: string, quantity: number, cap: number, itemId: string, now: string): Statement {
    return this.db.statement(
      `INSERT INTO cart_items (id, cart_id, variant_id, quantity) VALUES (?, ?, ?, ?)
       ON CONFLICT(cart_id, variant_id) DO UPDATE SET quantity = MIN(cart_items.quantity + excluded.quantity, ?), updated_at = ?`,
      itemId, cartId, variantId, quantity, cap, now,
    );
  }

  setQuantityStatement(cartId: string, itemId: string, quantity: number, now: string): Statement {
    return this.db.statement("UPDATE cart_items SET quantity = ?, updated_at = ? WHERE id = ? AND cart_id = ?", quantity, now, itemId, cartId);
  }

  deleteLineStatement(cartId: string, itemId: string): Statement {
    return this.db.statement("DELETE FROM cart_items WHERE id = ? AND cart_id = ?", itemId, cartId);
  }

  bumpVersionStatement(cartId: string, now: string, expectedVersion?: number): Statement {
    const expected = expectedVersion ?? null;
    return this.db.statement(
      "UPDATE carts SET version = version + 1, updated_at = ? WHERE id = ? AND (? IS NULL OR version = ?)",
      now, cartId, expected, expected,
    );
  }

  replaceCouponStatements(cartId: string, couponId: string | null): Statement[] {
    const out = [this.db.statement("DELETE FROM cart_coupons WHERE cart_id = ?", cartId)];
    if (couponId) out.push(this.db.statement("INSERT INTO cart_coupons (cart_id, coupon_id) VALUES (?, ?)", cartId, couponId));
    return out;
  }

  mergeStatements(guestCartId: string, memberCartId: string, now: string): Statement[] {
    return [
      this.db.statement(
        `INSERT INTO cart_items (id, cart_id, variant_id, quantity)
         SELECT lower(hex(randomblob(16))), ?, g.variant_id,
                MIN(g.quantity + COALESCE(m.quantity, 0), ?,
                    MAX(1, COALESCE((SELECT SUM(on_hand - reserved) FROM inventory_balances ib WHERE ib.variant_id = g.variant_id), 0)))
           FROM cart_items g LEFT JOIN cart_items m ON m.cart_id = ? AND m.variant_id = g.variant_id
          WHERE g.cart_id = ?
         ON CONFLICT(cart_id, variant_id) DO UPDATE SET quantity = excluded.quantity, updated_at = ?`,
        memberCartId, MAX_LINE_QTY, memberCartId, guestCartId, now,
      ),
      this.db.statement("UPDATE carts SET status = 'merged', updated_at = ? WHERE id = ?", now, guestCartId),
      this.bumpVersionStatement(memberCartId, now),
    ];
  }
}
