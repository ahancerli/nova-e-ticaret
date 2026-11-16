import { Repository, type Statement } from "@/core";
import type { RecentViewRepository } from "../application/ports";

export class D1RecentViewRepository extends Repository implements RecentViewRepository {
  async isPublished(productId: string): Promise<boolean> {
    return !!(await this.db.first("SELECT 1 AS ok FROM products WHERE id = ? AND status = 'published'", productId));
  }

  async productIds(visitorHash: string, since: string, limit: number): Promise<string[]> {
    const rows = await this.db.all<{ product_id: string }>(
      "SELECT product_id FROM recent_views WHERE visitor_key_hash = ? AND viewed_at >= ? ORDER BY viewed_at DESC, product_id LIMIT ?",
      visitorHash, since, limit,
    );
    return rows.map((r) => r.product_id);
  }

  recordStatements(visitorHash: string, productId: string, now: string, keep: number, since: string): Statement[] {
    return [
      this.db.statement(
        `INSERT INTO recent_views (visitor_key_hash, product_id, viewed_at) VALUES (?, ?, ?)
         ON CONFLICT (visitor_key_hash, product_id) DO UPDATE SET viewed_at = excluded.viewed_at`,
        visitorHash, productId, now,
      ),
      this.db.statement(
        `DELETE FROM recent_views WHERE visitor_key_hash = ? AND (viewed_at < ? OR product_id NOT IN (
           SELECT product_id FROM recent_views WHERE visitor_key_hash = ? ORDER BY viewed_at DESC, product_id LIMIT ?))`,
        visitorHash, since, visitorHash, keep,
      ),
    ];
  }

  clearStatement(visitorHash: string): Statement {
    return this.db.statement("DELETE FROM recent_views WHERE visitor_key_hash = ?", visitorHash);
  }
}
