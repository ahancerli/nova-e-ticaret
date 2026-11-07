import type { Statement } from "@/core";
import type { ProductEditorData, ProductListRow } from "../../domain/product";
import type { AttributeValueRow, CurrentProduct, PlannedVariant, ProductSavePlan } from "./plan-product-save";

/** Read side (CQRS): projections for the admin list and the editor. */
export interface ProductReadModel {
  list(): Promise<ProductListRow[]>;
  editor(id: string): Promise<ProductEditorData | null>;
  /** Brands + attribute catalogue + category→attribute rules (the category tree comes from the category module). */
  reference(): Promise<{
    brands: { id: string; name: string; isActive: boolean }[];
    attributes: { id: string; code: string; label: string; dataType: string; unit: string | null; isVariantAxis: boolean; displayStyle: "button" | "swatch" | "dropdown" }[];
    options: { id: string; attributeId: string; value: string; label: string; colorHex: string | null; isActive: boolean; numericValue: number | null }[];
    categoryAttributes: { categoryId: string; attributeId: string; isRequired: boolean }[];
  }>;
}

/**
 * Write side. Lookups run before planning; every write is a Statement the use case puts into one
 * UnitOfWork, with guards where the row's state must still match what was read.
 */
export interface ProductRepository {
  current(id: string): Promise<CurrentProduct | null>;
  identity(id: string): Promise<{ name: string; slug: string } | null>;
  galleryMediaIds(id: string): Promise<string[]>;
  slugTaken(slug: string, exceptProductId: string | null): Promise<boolean>;
  brandExists(id: string): Promise<boolean>;
  existingCategoryIds(ids: string[]): Promise<Set<string>>;
  existingImageIds(ids: string[]): Promise<Set<string>>;
  takenElsewhere(column: "sku" | "barcode", values: string[], exceptProductId: string | null): Promise<Set<string>>;

  /** Update guarded on `expectedUpdatedAt` when given (changes = 1 required). */
  upsertProductStatement(plan: ProductSavePlan, now: string): Statement;
  replaceCategoriesStatements(productId: string, categoryIds: string[], primaryId: string | null): Statement[];
  replaceGalleryStatements(productId: string, mediaIds: string[], primaryId: string | null, newId: () => string): Statement[];
  resetAxesStatements(productId: string, axes: string[]): Statement[];
  /** Deletes a never-used variant; the DELETE re-checks "no history" (changes = 1 required). */
  destroyVariantStatements(productId: string, variantId: string): { balance: Statement; variant: Statement };
  archiveVariantStatement(variantId: string, now: string): Statement;
  /** Clears per-product unique slots (default flag, combination keys) before variants are rewritten. */
  freeVariantSlotsStatements(productId: string, keptVariantIds: string[]): Statement[];
  writeVariantStatement(productId: string, v: PlannedVariant, now: string): Statement;
  priceStatement(v: PlannedVariant, now: string): Statement;
  createBalanceStatement(variantId: string, onHand: number): Statement;
  /** Absolute stock write guarded on the on-hand value the editor saw (changes = 1 required). */
  adjustBalanceStatement(variantId: string, expectedOnHand: number, onHand: number, now: string): Statement;
  movementStatement(m: { variantId: string; productId: string; kind: "receipt" | "adjustment"; delta: number; actorId: string; id: string; idempotencyKey: string }): Statement;
  variantOptionStatements(variantId: string, options: Record<string, string>): Statement[];
  replaceAttributeValuesStatements(productId: string, rows: AttributeValueRow[], newId: () => string): Statement[];
  seoStatement(productId: string, seo: ProductSavePlan["seo"], newId: () => string): Statement;

  /** No-op UPDATE that only matches while no variant has order / stock history (guard it, changes = 1). */
  assertNoHistoryStatement(productId: string): Statement;
  deleteProductStatements(productId: string): Statement[];
}
