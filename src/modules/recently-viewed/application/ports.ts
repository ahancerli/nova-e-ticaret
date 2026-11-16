import type { Statement } from "@/core";
import type { ProductCard } from "@/lib/types";

export interface RecentViewRepository {
  isPublished(productId: string): Promise<boolean>;
  /** Product ids, most recent first, newer than `since`. */
  productIds(visitorHash: string, since: string, limit: number): Promise<string[]>;
  /** Upsert the view, keep the newest `keep` rows of the visitor and drop rows older than `since`. */
  recordStatements(visitorHash: string, productId: string, now: string, keep: number, since: string): Statement[];
  clearStatement(visitorHash: string): Statement;
}

/** Shop cards with live price / stock / campaigns (bound to the storefront read side). */
export interface RecentCards {
  execute(ids: string[]): Promise<ProductCard[]>;
}

/** Functional cookie consent of the browser (bound to the consent module). */
export interface FunctionalConsent {
  execute(cookieHeader: string | null): Promise<boolean>;
}
