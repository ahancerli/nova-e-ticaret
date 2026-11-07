import type { Statement } from "@/core";
import type { AttributeInput, AttributeRow, OptionInput } from "../domain/attribute";
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

/** Attribute definitions, options, category assignments and the barcode sequence (Katalog › Özellikler). */
export interface AttributeRepository {
  list(): Promise<AttributeRow[]>;
  find(id: string): Promise<AttributeRow | null>;
  codeTaken(code: string, exceptId: string | null): Promise<boolean>;
  valueTaken(attributeId: string, value: string, exceptId: string | null): Promise<boolean>;
  maxOptionOrder(attributeId: string): Promise<number>;
  existingCategories(ids: string[]): Promise<number>;
  insertStatement(id: string, code: string, a: AttributeInput): Statement;
  updateStatement(id: string, a: AttributeInput): Statement;
  deleteStatement(id: string): Statement;
  insertOptionStatement(id: string, attributeId: string, value: string, o: OptionInput, sortOrder: number): Statement;
  updateOptionStatement(id: string, attributeId: string, o: OptionInput): Statement;
  deleteOptionStatement(id: string, attributeId: string): Statement;
  reorderOptionStatements(attributeId: string, ids: string[]): Statement[];
  replaceCategoriesStatements(attributeId: string, cats: { categoryId: string; isRequired: boolean }[]): Statement[];
  barcodeSettings(): Promise<{ prefix: string; nextValue: number }>;
  setPrefixStatement(prefix: string): Statement;
  reserveNumbers(count: number): Promise<{ prefix: string; first: number }>;
  takenBarcodes(codes: string[]): Promise<Set<string>>;
}

