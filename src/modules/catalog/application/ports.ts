import type { Statement } from "@/core";
import type { BrandPatch, BrandRow } from "../domain/brand";
import type { CategoryPatch, CategoryRecord } from "../domain/category";

/** Persistence port for categories. Reads run immediately; writes return statements for a UnitOfWork. */
export interface CategoryRepository {
  listAll(): Promise<CategoryRecord[]>;
  findMediaRefs(id: string): Promise<{ id: string; name: string; slug: string; imageMediaId: string | null; menuMediaId: string | null } | null>;
  exists(id: string): Promise<boolean>;
  /** True when `candidateId` is somewhere below `ancestorId`. */
  isDescendant(ancestorId: string, candidateId: string): Promise<boolean>;
  slugTaken(slug: string, exceptId: string | null): Promise<boolean>;
  dependents(id: string): Promise<{ children: number; products: number }>;
  sampleProducts(id: string, limit: number): Promise<{ id: string; name: string; slug: string; status: string }[]>;
  insertStatement(c: { id: string; parentId: string | null; name: string; slug: string; description: string | null; imageMediaId: string | null; menuMediaId: string | null; sortOrder: number; isActive: boolean; now: string }): Statement;
  updateStatement(id: string, patch: CategoryPatch & { slug?: string }, now: string): Statement;
  /** Deletes only while the category still has no children and no products (guard the result). */
  deleteIfUnusedStatement(id: string): Statement;
}

export interface BrandRepository {
  list(): Promise<BrandRow[]>;
  find(id: string): Promise<BrandRow | null>;
  slugTaken(slug: string, exceptId: string | null): Promise<boolean>;
  insertStatement(b: { id: string; name: string; slug: string; description: string | null; logoMediaId: string | null; bannerMediaId: string | null; websiteUrl: string | null; isActive: boolean; now: string }): Statement;
  updateStatement(id: string, patch: BrandPatch & { slug?: string }, now: string): Statement;
  /** Deletes only while the brand still has no products and no stories (guard the result). */
  deleteIfUnusedStatement(id: string): Statement;
}
