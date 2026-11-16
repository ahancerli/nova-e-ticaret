import type { Statement } from "@/core";
import type { ProductCard } from "@/lib/types";

export interface WishlistRepository {
  isPublished(productId: string): Promise<boolean>;
  /** Product ids on the customer's list, last added first. */
  productIds(userId: string): Promise<string[]>;
  count(userId: string): Promise<number>;
  /**
   * Creates the customer's list when there is none, then adds the product to their (oldest) list — idempotent; one
   * batch, so two first hearts at once still end up on a single list.
   */
  addStatements(row: { listId: string; userId: string; productId: string; now: string }): Statement[];
  removeStatement(userId: string, productId: string): Statement;
}

/** Shop cards with live price / stock / campaigns (bound to the storefront read side). */
export interface WishlistCards {
  execute(ids: string[]): Promise<ProductCard[]>;
}
