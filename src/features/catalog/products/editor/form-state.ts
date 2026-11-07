import { PRODUCT_STATUSES } from "@/lib/product-rules";
import type { ProductEditorData } from "@/modules/catalog";
import type { GalleryItem } from "@/features/media/MediaGallery";

// ---------------------------------------------------------------------------
// Form model (strings for numeric inputs; converted on save)
// ---------------------------------------------------------------------------
export type Status = ProductEditorData["status"];
export type VariantState = {
  key: string; id?: string; sku: string; barcode: string; name: string; options: Record<string, string>;
  price: string; compareAt: string; minPrice: string; stock: string; isActive: boolean; isDefault: boolean;
  weightGrams: string; widthMm: string; heightMm: string; depthMm: string; reserved: number; locked: boolean;
  /** Stock as loaded: the server only writes stock that the user actually changed, guarded on this value. */
  loadedStock?: number;
  /** The variant's own photos (shown instead of the gallery when it is picked in the shop). */
  media: GalleryItem[];
};
export type FormState = {
  name: string; slug: string; status: Status; shortDescription: string; descriptionHtml: string; taxRateBps: number;
  warrantyMonths: string; countryOfOrigin: string; accountingCode: string; manufacturerCode: string; modelCode: string;
  brandId: string; categories: { id: string; primary: boolean }[]; media: GalleryItem[]; primaryMediaId: string | null;
  axes: string[]; variants: VariantState[];
  /** Axis whose values carry the photos (Renk); "none" = every variant uses the gallery; undefined = automatic. Editor only. */
  imageAxis?: string;
  attributes: Record<string, (string | number | boolean)[]>;
  seo: { metaTitle: string; metaDescription: string; canonicalUrl: string; noindex: boolean };
};
export type Errors = Record<string, string[]>;

export const STATUSES = PRODUCT_STATUSES;

export const TAX_RATES = [0, 100, 1000, 2000];

export const str = (v: number | string | null | undefined) => (v == null ? "" : String(v));
export const minorToStr = (m: number | null | undefined) => (m == null ? "" : (m / 100).toFixed(2).replace(".", ","));
export const strToMinor = (s: string): number | null => {
  const t = s.trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
};
export const strToInt = (s: string): number | null => (s.trim() === "" ? null : /^\d+$/.test(s.trim()) ? Number.parseInt(s, 10) : NaN);
export const uid = () => crypto.randomUUID();

export const emptyVariant = (isDefault: boolean, options: Record<string, string> = {}): VariantState => ({
  key: uid(), sku: "", barcode: "", name: "", options, price: "", compareAt: "", minPrice: "", stock: "0", isActive: true, isDefault,
  weightGrams: "", widthMm: "", heightMm: "", depthMm: "", reserved: 0, locked: false, media: [],
});

export function fromData(d: ProductEditorData | null): FormState {
  if (!d) {
    return {
      name: "", slug: "", status: "draft", shortDescription: "", descriptionHtml: "", taxRateBps: 2000, warrantyMonths: "", countryOfOrigin: "",
      accountingCode: "", manufacturerCode: "", modelCode: "", brandId: "", categories: [], media: [], primaryMediaId: null, axes: [],
      variants: [emptyVariant(true)], attributes: {}, seo: { metaTitle: "", metaDescription: "", canonicalUrl: "", noindex: false },
    };
  }
  return {
    name: d.name, slug: d.slug, status: d.status, shortDescription: d.shortDescription ?? "", descriptionHtml: d.descriptionHtml ?? "",
    taxRateBps: d.taxRateBps, warrantyMonths: str(d.warrantyMonths), countryOfOrigin: d.countryOfOrigin ?? "", accountingCode: d.accountingCode ?? "",
    manufacturerCode: d.manufacturerCode ?? "", modelCode: d.modelCode ?? "", brandId: d.brandId ?? "", categories: d.categories, media: d.media, primaryMediaId: d.primaryMediaId,
    axes: d.axes,
    variants: d.variants.map((v) => ({
      key: v.id, id: v.id, sku: v.sku, barcode: v.barcode ?? "", name: v.name ?? "", options: v.options, price: minorToStr(v.priceMinor),
      compareAt: minorToStr(v.compareAtMinor), minPrice: minorToStr(v.minPriceMinor), stock: String(v.stock), isActive: v.isActive, isDefault: v.isDefault,
      weightGrams: str(v.weightGrams), widthMm: str(v.widthMm), heightMm: str(v.heightMm), depthMm: str(v.depthMm), reserved: v.reserved, locked: v.locked,
      loadedStock: v.stock, media: v.media,
    })),
    attributes: Object.fromEntries(d.attributes.map((a) => [a.attributeId, a.values])),
    seo: { metaTitle: d.seo.metaTitle ?? "", metaDescription: d.seo.metaDescription ?? "", canonicalUrl: d.seo.canonicalUrl ?? "", noindex: d.seo.noindex },
  };
}

export function toPayload(f: FormState) {
  return {
    name: f.name.trim(), slug: f.slug.trim() || undefined, status: f.status, shortDescription: f.shortDescription || null, descriptionHtml: f.descriptionHtml || null,
    taxRateBps: f.taxRateBps, warrantyMonths: strToInt(f.warrantyMonths), countryOfOrigin: f.countryOfOrigin.trim() || null,
    accountingCode: f.accountingCode || null, manufacturerCode: f.manufacturerCode || null, modelCode: f.modelCode.trim() || null, brandId: f.brandId || null,
    categories: f.categories, media: f.media.map((m) => m.mediaId), primaryMediaId: f.primaryMediaId, axes: f.axes,
    variants: f.variants.map((v) => ({
      ...(v.id ? { id: v.id } : {}), sku: v.sku.trim(), barcode: v.barcode.trim() || null, name: v.name.trim() || null,
      options: Object.fromEntries(f.axes.map((a) => [a, v.options[a] ?? ""]).filter(([, o]) => o)),
      priceMinor: strToMinor(v.price) ?? 0, compareAtMinor: strToMinor(v.compareAt), minPriceMinor: strToMinor(v.minPrice), stock: strToInt(v.stock) ?? 0,
      ...(v.loadedStock !== undefined ? { expectedStock: v.loadedStock } : {}),
      isActive: v.isActive, isDefault: v.isDefault,
      weightGrams: strToInt(v.weightGrams), widthMm: strToInt(v.widthMm), heightMm: strToInt(v.heightMm), depthMm: strToInt(v.depthMm),
      media: v.media.map((m) => m.mediaId),
    })),
    attributes: Object.entries(f.attributes).filter(([a]) => !f.axes.includes(a)).map(([attributeId, values]) => ({ attributeId, values: values.filter((v) => v !== "") })),
    seo: { metaTitle: f.seo.metaTitle || null, metaDescription: f.seo.metaDescription || null, canonicalUrl: f.seo.canonicalUrl || null, noindex: f.seo.noindex },
  };
}
