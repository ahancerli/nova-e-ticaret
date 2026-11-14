/** Product aggregate: read models and editor reference data (pure types). */
import type { ProductStatus } from "@/lib/product-rules";

export type { ProductStatus };

/** Single price list and warehouse the app uses today (spec D03, db/README.md §5). */
export const DEFAULT_PRICE_LIST = "pl_retail";
export const DEFAULT_WAREHOUSE = "wh_main";

export interface ProductListRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  brandName: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  variantCount: number;
  available: number;
  updatedAt: string;
}

export type AttributeDataType = "text" | "number" | "boolean" | "select" | "multiselect";

export interface AttributeMeta {
  id: string;
  code: string;
  label: string;
  dataType: AttributeDataType;
  unit: string | null;
  isVariantAxis: boolean;
  /** How shoppers pick it (variant axes). */
  displayStyle?: "button" | "swatch" | "dropdown";
  /** Variant axis whose values change the photos (Renk): the editor assigns images per value. */
  variesMedia?: boolean;
  /** Inactive options stay on existing variants but are not offered for new ones. */
  options: { id: string; value: string; label: string; colorHex: string | null; isActive?: boolean; numericValue?: number | null }[];
}

/** Reference data for the product editor. */
export interface ProductMeta {
  brands: { id: string; name: string; isActive: boolean }[];
  categories: { id: string; parentId: string | null; name: string; depth: number; path: string; isActive: boolean }[];
  attributes: AttributeMeta[];
  /** category_attributes rows: a required attribute applies to the category and all of its descendants. */
  categoryAttributes: { categoryId: string; attributeId: string; isRequired: boolean }[];
}

export interface EditorVariant {
  id: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  options: Record<string, string>;
  priceMinor: number;
  compareAtMinor: number | null;
  /** Floor price for campaigns (null = none). */
  minPriceMinor: number | null;
  /** 30-day lowest price rule, read only: cap of the current price and the cap a price change made now would get. */
  priceCaps?: { lowestPriorMinor: number | null; lowest30dMinor: number | null };
  stock: number;
  reserved: number;
  isActive: boolean;
  isDefault: boolean;
  weightGrams: number | null;
  widthMm: number | null;
  heightMm: number | null;
  depthMm: number | null;
  /** Sold / moved / reserved: SKU and combination are frozen, the variant is archived instead of deleted. */
  locked: boolean;
  /** The variant's own photos (shown instead of the shared gallery when it is picked). */
  media: { mediaId: string; url: string }[];
}

export interface ProductEditorData {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  shortDescription: string | null;
  descriptionHtml: string | null;
  taxRateBps: number;
  warrantyMonths: number | null;
  countryOfOrigin: string | null;
  accountingCode: string | null;
  manufacturerCode: string | null;
  /** Model kodu (Trendyol productMainId): groups the variants of one model in bulk sheets and on marketplaces. */
  modelCode: string | null;
  brandId: string | null;
  publishedAt: string | null;
  createdAt: string;
  /** Also the optimistic-concurrency token: the editor sends it back as `expectedUpdatedAt`. */
  updatedAt: string;
  categories: { id: string; primary: boolean }[];
  media: { mediaId: string; url: string }[];
  primaryMediaId: string | null;
  axes: string[];
  variants: EditorVariant[];
  attributes: { attributeId: string; values: (string | number | boolean)[] }[];
  seo: { metaTitle: string | null; metaDescription: string | null; canonicalUrl: string | null; noindex: boolean };
}

export interface SavedProduct {
  id: string;
  slug: string;
  archivedVariants: string[];
  deletedVariants: string[];
}
