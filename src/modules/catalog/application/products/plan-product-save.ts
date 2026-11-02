import { slugify } from "@/lib/slug";
import { requiredAttributeIds } from "@/lib/product-rules";
import type { FieldErrors } from "@/core";
import type { AttributeMeta, ProductMeta, ProductStatus } from "../../domain/product";
import type { ProductInput } from "./product-input";

/**
 * Pure planning step of "save product": validates the whole aggregate against the current state and
 * reference data, and produces either field errors or a complete write plan. No I/O — everything it
 * needs is loaded beforehand and passed in, so every rule is unit-testable.
 */

export interface CurrentVariant {
  id: string;
  sku: string;
  combinationKey: string;
  onHand: number;
  reserved: number;
  hasBalance: boolean;
  locked: boolean;
}

export interface CurrentProduct {
  status: string;
  publishedAt: string | null;
  updatedAt: string;
  variants: CurrentVariant[];
  /** Gallery (non-variant) media currently attached. */
  mediaIds: string[];
}

/** Results of the existence / uniqueness lookups for the values in the input. */
export interface SaveLookups {
  slugTaken: boolean;
  brandExists: boolean;
  foundCategoryIds: ReadonlySet<string>;
  foundImageIds: ReadonlySet<string>;
  skusTakenElsewhere: ReadonlySet<string>;
  barcodesTakenElsewhere: ReadonlySet<string>;
}

export type StockChange =
  | { kind: "none" }
  | { kind: "create"; onHand: number }
  /** `expectedOnHand` is what the editor's numbers were based on; the write is guarded on it. */
  | { kind: "adjust"; expectedOnHand: number; onHand: number; delta: number };

export interface PlannedVariant {
  id: string;
  isNew: boolean;
  sku: string;
  barcode: string | null;
  name: string | null;
  combinationKey: string;
  options: Record<string, string>;
  weightGrams: number | null;
  widthMm: number | null;
  heightMm: number | null;
  depthMm: number | null;
  isActive: boolean;
  isDefault: boolean;
  priceMinor: number;
  compareAtMinor: number | null;
  stock: StockChange;
}

export interface AttributeValueRow {
  attributeId: string;
  index: number;
  text: string | null;
  number: number | null;
  bool: 0 | 1 | null;
  option: string | null;
}

export interface ProductSavePlan {
  productId: string;
  isNew: boolean;
  /** Present for updates that carried `expectedUpdatedAt`. */
  expectedUpdatedAt: string | null;
  fields: {
    brandId: string | null;
    name: string;
    slug: string;
    shortDescription: string | null;
    descriptionHtml: string | null;
    accountingCode: string | null;
    manufacturerCode: string | null;
    status: ProductStatus;
    taxRateBps: number;
    warrantyMonths: number | null;
    countryOfOrigin: string | null;
    publishedAt: string | null;
  };
  categoryIds: string[];
  primaryCategoryId: string | null;
  mediaIds: string[];
  primaryMediaId: string | null;
  axes: string[];
  variants: PlannedVariant[];
  /** Never used: deleted. */
  destroy: { id: string; sku: string }[];
  /** Part of the ledger (sold / moved / reserved): deactivated instead. */
  archive: { id: string; sku: string }[];
  attributeValues: AttributeValueRow[];
  seo: { metaTitle: string | null; metaDescription: string | null; canonicalUrl: string | null; noindex: boolean } | null;
  /** Gallery media no longer attached: released after commit. */
  detachedMediaIds: string[];
}

export const normalizeSku = (sku: string) => sku.trim().toUpperCase();
export const normalizeProductSlug = (input: Pick<ProductInput, "slug" | "name">) => slugify(input.slug?.trim() || input.name);

const textOrNull = (v: string | null | undefined) => v?.trim() || null;

export function planProductSave(args: {
  productId: string | null;
  input: ProductInput;
  current: CurrentProduct | null;
  meta: ProductMeta;
  lookups: SaveLookups;
  canPublish: boolean;
  now: string;
  newId: () => string;
}): { errors: FieldErrors; plan: ProductSavePlan | null } {
  const { input, current, meta, lookups, canPublish, now, newId } = args;
  const errors: FieldErrors = {};
  const push = (k: string, m: string) => void (errors[k] ??= []).push(m);

  // --- general ---
  const slug = normalizeProductSlug(input);
  if (slug.length < 2) push("slug", "Geçerli bir slug girin.");
  else if (lookups.slugTaken) push("slug", "Bu slug başka bir üründe kullanılıyor.");
  const publishing = input.status === "published" && current?.status !== "published";
  if (publishing && !canPublish) push("status", "Ürünü yayına almak için “catalog.publish” yetkisi gerekiyor.");

  // --- brand / categories ---
  if (input.brandId && !lookups.brandExists) push("brandId", "Marka bulunamadı.");
  const requestedCats = [...new Set(input.categories.map((c) => c.id))];
  const categoryIds = requestedCats.filter((c) => lookups.foundCategoryIds.has(c));
  if (categoryIds.length !== requestedCats.length) push("categories", "Seçilen kategorilerden biri bulunamadı.");
  if (!requestedCats.length) push("categories", "En az bir kategori seçin.");
  const primaryCategoryId = input.categories.find((c) => c.primary && lookups.foundCategoryIds.has(c.id))?.id ?? categoryIds[0] ?? null;

  // --- media ---
  const mediaIds = [...new Set(input.media)];
  if (mediaIds.some((m) => !lookups.foundImageIds.has(m))) push("media", "Galerideki bir görsel bulunamadı; yeniden yükleyin.");
  const primaryMediaId = input.primaryMediaId && mediaIds.includes(input.primaryMediaId) ? input.primaryMediaId : mediaIds[0] ?? null;
  if (input.status === "published" && !mediaIds.length) push("media", "Yayındaki bir ürün için en az bir görsel gerekli.");

  // --- variant axes ---
  const attrById = new Map<string, AttributeMeta>(meta.attributes.map((a) => [a.id, a]));
  const axes = [...new Set(input.axes)];
  for (const a of axes) if (!attrById.get(a)?.isVariantAxis) push("axes", "Seçilen eksen bir varyant ekseni değil.");

  // --- variants ---
  const curById = new Map((current?.variants ?? []).map((v) => [v.id, v]));
  const keepIds = new Set<string>();
  const combos = new Map<string, number>();
  const skus = new Map<string, number>();
  const barcodes = new Map<string, number>();

  const prepared = input.variants.map((v, i) => {
    const k = (f: string) => `variants.${i}.${f}`;
    const cur = v.id ? curById.get(v.id) : undefined;
    if (v.id && !cur) push(k("id"), "Varyant bu ürüne ait değil.");
    if (cur) keepIds.add(cur.id);

    const parts: string[] = [];
    for (const axisId of axes) {
      const attr = attrById.get(axisId);
      if (!attr) continue;
      const opt = attr.options.find((o) => o.id === v.options[axisId]);
      if (!opt) push(k(`options.${axisId}`), `${attr.label} seçin.`);
      else parts.push(`${attr.code}=${opt.value}`);
    }
    for (const key of Object.keys(v.options)) if (!axes.includes(key)) push(k("options"), "Seçili olmayan bir eksen için değer gönderildi.");
    const combinationKey = axes.length ? parts.join(";") : "default";
    if (combos.has(combinationKey)) push(k("options"), `Bu kombinasyon ${combos.get(combinationKey)! + 1}. varyantta da var.`);
    combos.set(combinationKey, i);

    const sku = normalizeSku(v.sku);
    if (skus.has(sku)) push(k("sku"), "SKU tekrar ediyor.");
    skus.set(sku, i);
    if (lookups.skusTakenElsewhere.has(sku)) push(k("sku"), "Bu SKU başka bir üründe kullanılıyor.");
    const barcode = v.barcode?.trim() || null;
    if (barcode) {
      if (barcodes.has(barcode)) push(k("barcode"), "Barkod tekrar ediyor.");
      barcodes.set(barcode, i);
      if (lookups.barcodesTakenElsewhere.has(barcode)) push(k("barcode"), "Bu barkod başka bir üründe kullanılıyor.");
    }
    if (cur?.locked && (cur.sku !== sku || (axes.length && cur.combinationKey !== combinationKey))) {
      push(k("sku"), "Satılmış / stok hareketi olan varyantın SKU ve kombinasyonu değiştirilemez. Yeni varyant ekleyin.");
    }
    if (cur && v.stock < cur.reserved) push(k("stock"), `Rezerve edilmiş ${cur.reserved} adetin altına düşürülemez.`);

    // Stock is written only when the user changed it, relative to what the editor showed (expectedStock).
    // Comparing with the current DB value instead would silently undo sales made while the editor was open.
    let stock: StockChange;
    if (!cur?.hasBalance) stock = { kind: "create", onHand: v.stock };
    else {
      const base = v.expectedStock ?? cur.onHand;
      stock = v.stock === base ? { kind: "none" } : { kind: "adjust", expectedOnHand: base, onHand: v.stock, delta: v.stock - base };
    }

    const planned: PlannedVariant = {
      id: cur?.id ?? newId(),
      isNew: !cur,
      sku,
      barcode,
      name: textOrNull(v.name),
      combinationKey,
      options: Object.fromEntries(axes.map((a) => [a, v.options[a]!])),
      weightGrams: v.weightGrams ?? null,
      widthMm: v.widthMm ?? null,
      heightMm: v.heightMm ?? null,
      depthMm: v.depthMm ?? null,
      isActive: v.isActive,
      isDefault: false,
      priceMinor: v.priceMinor,
      compareAtMinor: v.compareAtMinor ?? null,
      stock,
    };
    return { planned, wantsDefault: v.isDefault && v.isActive };
  });
  if (!axes.length && prepared.length > 1) push("axes", "Birden fazla varyant için en az bir varyant ekseni (örn. Renk, Beden) seçin.");

  // Removed variants: delete if never used, otherwise archive (inactive) to keep the ledger intact.
  const removed = (current?.variants ?? []).filter((v) => !keepIds.has(v.id));
  const isLedger = (v: CurrentVariant) => v.locked || v.reserved > 0;
  const archive = removed.filter(isLedger);
  const destroy = removed.filter((v) => !isLedger(v));
  for (const a of archive) {
    if (combos.has(a.combinationKey)) push(`variants.${combos.get(a.combinationKey)}.options`, `Bu kombinasyon arşivlenen ${a.sku} varyantında kayıtlı.`);
  }

  // Exactly one default: the first active one marked default, else the first variant.
  const defaultIdx = Math.max(0, prepared.findIndex((p) => p.wantsDefault));
  const variants = prepared.map((p, i) => ({ ...p.planned, isDefault: i === defaultIdx }));

  // --- specs (this product's variant axes are SKU data, not specs) ---
  const attributeValues: AttributeValueRow[] = [];
  input.attributes.forEach((a, i) => {
    const attr = attrById.get(a.attributeId);
    if (!attr) return push(`attributes.${i}`, "Özellik bulunamadı.");
    if (axes.includes(attr.id)) return;
    const vals = a.values.filter((v) => v !== "" && v != null);
    const list = attr.dataType === "multiselect" ? vals : vals.slice(0, 1);
    list.forEach((raw, index) => {
      const row: AttributeValueRow = { attributeId: attr.id, index, text: null, number: null, bool: null, option: null };
      if (attr.dataType === "text") row.text = String(raw).slice(0, 500);
      else if (attr.dataType === "number") {
        const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
        if (!Number.isFinite(n)) return push(`attributes.${attr.id}`, `${attr.label} sayı olmalı.`);
        row.number = n;
      } else if (attr.dataType === "boolean") row.bool = raw === true || raw === "true" || raw === 1 ? 1 : 0;
      else {
        if (!attr.options.some((o) => o.id === raw)) return push(`attributes.${attr.id}`, `${attr.label} için geçersiz seçenek.`);
        row.option = String(raw);
      }
      attributeValues.push(row);
    });
  });

  // Attributes the selected categories (or their ancestors) mark as required; variant axes satisfy them via SKUs.
  for (const attrId of requiredAttributeIds(meta, categoryIds)) {
    if (axes.includes(attrId) || attributeValues.some((r) => r.attributeId === attrId)) continue;
    push(`attributes.${attrId}`, `${attrById.get(attrId)?.label ?? "Özellik"} bu kategori için zorunlu.`);
  }

  if (Object.keys(errors).length) return { errors, plan: null };

  const seoTitle = textOrNull(input.seo.metaTitle);
  const seoDesc = textOrNull(input.seo.metaDescription);
  const canonical = textOrNull(input.seo.canonicalUrl);
  const hasSeo = Boolean(seoTitle || seoDesc || canonical || input.seo.noindex);

  return {
    errors,
    plan: {
      productId: args.productId ?? newId(),
      isNew: !args.productId,
      expectedUpdatedAt: args.productId ? input.expectedUpdatedAt ?? null : null,
      fields: {
        brandId: input.brandId ?? null,
        name: input.name.trim(),
        slug,
        shortDescription: textOrNull(input.shortDescription),
        descriptionHtml: textOrNull(input.descriptionHtml),
        accountingCode: textOrNull(input.accountingCode),
        manufacturerCode: textOrNull(input.manufacturerCode),
        status: input.status,
        taxRateBps: input.taxRateBps,
        warrantyMonths: input.warrantyMonths ?? null,
        countryOfOrigin: input.countryOfOrigin ? input.countryOfOrigin.toUpperCase() : null,
        publishedAt: current?.publishedAt ?? (input.status === "published" ? now : null),
      },
      categoryIds,
      primaryCategoryId,
      mediaIds,
      primaryMediaId,
      axes,
      variants,
      destroy: destroy.map((v) => ({ id: v.id, sku: v.sku })),
      archive: archive.map((v) => ({ id: v.id, sku: v.sku })),
      attributeValues,
      seo: hasSeo ? { metaTitle: seoTitle, metaDescription: seoDesc, canonicalUrl: canonical, noindex: input.seo.noindex } : null,
      detachedMediaIds: (current?.mediaIds ?? []).filter((m) => !mediaIds.includes(m)),
    },
  };
}
