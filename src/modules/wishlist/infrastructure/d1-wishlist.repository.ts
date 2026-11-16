import type { Database, Statement } from "@/core";
import { DEFAULT_WISHLIST_NAME } from "../domain/wishlist";
import type { WishlistRepository } from "../application/ports";

// the customer's list = their oldest one (the schema allows several; the shop uses one)
const LIST_OF_USER = "SELECT id FROM wishlists WHERE user_id = ? ORDER BY created_at, id LIMIT 1";

export class D1WishlistRepository implements WishlistRepository {
  constructor(private readonly db: Database) {}

  async isPublished(productId: string): Promise<boolean> {
    return Boolean(await this.db.first("SELECT 1 AS ok FROM products WHERE id = ? AND status = 'published'", productId));
  }

  async productIds(userId: string): Promise<string[]> {
    const rows = await this.db.all<{ product_id: string }>(
      `SELECT i.product_id FROM wishlist_items i JOIN wishlists w ON w.id = i.wishlist_id
        WHERE w.user_id = ? GROUP BY i.product_id ORDER BY MAX(i.created_at) DESC, i.product_id`,
      userId,
    );
    return rows.map((r) => r.product_id);
  }

  async count(userId: string): Promise<number> {
    const r = await this.db.first<{ n: number }>(
      "SELECT COUNT(DISTINCT i.product_id) AS n FROM wishlist_items i JOIN wishlists w ON w.id = i.wishlist_id WHERE w.user_id = ?", userId,
    );
    return r?.n ?? 0;
  }

  addStatements(row: { listId: string; userId: string; productId: string; now: string }): Statement[] {
    return [
      this.db.statement(
        "INSERT INTO wishlists (id, user_id, name, created_at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM wishlists WHERE user_id = ?)",
        row.listId, row.userId, DEFAULT_WISHLIST_NAME, row.now, row.userId,
      ),
      this.db.statement(
        `INSERT OR IGNORE INTO wishlist_items (wishlist_id, product_id, created_at) SELECT (${LIST_OF_USER}), ?, ?`,
        row.userId, row.productId, row.now,
      ),
    ];
  }

  removeStatement(userId: string, productId: string): Statement {
    return this.db.statement(
      "DELETE FROM wishlist_items WHERE product_id = ? AND wishlist_id IN (SELECT id FROM wishlists WHERE user_id = ?)", productId, userId,
    );
  }
}
