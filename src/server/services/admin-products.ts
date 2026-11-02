import "server-only";
import type { z } from "zod";
import { getDb, placeholders } from "../db";
import { ApiError } from "../http";
import { newId, nowIso } from "@/lib/ids";
import { slugify } from "@/lib/slug";
import { requiredAttributeIds } from "@/lib/product-rules";
import type { adminProductSchema } from "../validation";
import { DEFAULT_PRICE_LIST } from "./catalog";
import { ListCategoryTreeToken } from "@/modules/catalog";
import { MediaLibraryToken } from "@/modules/media";
import { resolveService } from "../app";

// Bridges to the new modules until products move to src/modules (Phase 3, step 2).
const listCategoryTree = async () => (await resolveService(ListCategoryTreeToken)).execute();
const releaseMedia = async (id: string | null | undefined) => (await resolveService(MediaLibraryToken)).release(id);

export type ProductInput = z.infer<typeof adminProductSchema>;

const WAREHOUSE_ID = "wh_main"; // single warehouse to start (spec D03)

/** A variant with order lines, stock movements or reservations is part of the ledger: never deleted, never re-keyed. */
const LOCKED_SQL = `(EXISTS (SELECT 1 FROM order_items oi WHERE oi.variant_id = v.id)
                  OR EXISTS (SELECT 1 FROM inventory_movements im WHERE im.variant_id = v.id)
                  OR EXISTS (SELECT 1 FROM stock_reservations sr WHERE sr.variant_id = v.id))`;

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
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

export async function listAdminProducts(): Promise<ProductListRow[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(`SELECT p.id, p.name, p.slug, p.status, p.updated_at, b.name AS brand_name,
                     (SELECT c.name FROM product_categories pc JOIN categories c ON c.id = pc.category_id
                       WHERE pc.product_id = p.id ORDER BY pc.is_primary DESC LIMIT 1) AS category_name,
                     (SELECT m.public_url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
                       WHERE pm.product_id = p.id ORDER BY pm.is_primary DESC, pm.sort_order LIMIT 1) AS image_url,
                     (SELECT MIN(vp.unit_price_minor) FROM product_variants v JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?1
                       WHERE v.product_id = p.id) AS min_price,
                     (SELECT MAX(vp.unit_price_minor) FROM product_variants v JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?1
                       WHERE v.product_id = p.id) AS max_price,
                     (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) AS variant_count,
                     (SELECT COALESCE(SUM(ib.on_hand - ib.reserved), 0) FROM inventory_balances ib JOIN product_variants v ON v.id = ib.variant_id
                       WHERE v.product_id = p.id) AS available
                FROM products p LEFT JOIN brands b ON b.id = p.brand_id
               ORDER BY p.updated_at DESC, p.id`)
    .bind(DEFAULT_PRICE_LIST)
    .all<{ id: string; name: string; slug: string; status: string; updated_at: string; brand_name: string | null; category_name: string | null; image_url: string | null; min_price: number | null; max_price: number | null; variant_count: number; available: number }>();
  return (results ?? []).map((r) => ({
    id: r.id, name: r.name, slug: r.slug, status: r.status, brandName: r.brand_name, categoryName: r.category_name, imageUrl: r.image_url,
    minPriceMinor: r.min_price, maxPriceMinor: r.max_price, variantCount: Number(r.variant_count), available: Number(r.available), updatedAt: r.updated_at,
  }));
}

// ---------------------------------------------------------------------------
// Reference data for the editor (brands, category tree, attribute catalogue)
// ---------------------------------------------------------------------------
export interface AttributeMeta {
  id: string; code: string; label: string; dataType: "text" | "number" | "boolean" | "select" | "multiselect"; unit: string | null; isVariantAxis: boolean;
  options: { id: string; value: string; label: string; colorHex: string | null }[];
}
export interface ProductMeta {
  brands: { id: string; name: string; isActive: boolean }[];
  categories: { id: string; parentId: string | null; name: string; depth: number; path: string; isActive: boolean }[];
  attributes: AttributeMeta[];
  /** category_attributes rows: a required attribute applies to the category and all of its descendants. */
  categoryAttributes: { categoryId: string; attributeId: string; isRequired: boolean }[];
}

export async function getProductMeta(): Promise<ProductMeta> {
  const db = await getDb();
  const [brands, attrs, opts, catAttrs] = await db.batch([
    db.prepare("SELECT id, name, is_active FROM brands ORDER BY name COLLATE NOCASE"),
    db.prepare("SELECT id, code, label, data_type, unit, is_variant_axis FROM attribute_definitions ORDER BY label COLLATE NOCASE"),
    db.prepare("SELECT id, attribute_id, value_code, label, color_hex FROM attribute_options ORDER BY attribute_id, sort_order, label"),
    db.prepare("SELECT category_id, attribute_id, is_required FROM category_attributes"),
  ]);
  const { flat } = await listCategoryTree();
  const options = (opts!.results ?? []) as { id: string; attribute_id: string; value_code: string; label: string; color_hex: string | null }[];
  return {
    brands: ((brands!.results ?? []) as { id: string; name: string; is_active: number }[]).map((b) => ({ id: b.id, name: b.name, isActive: b.is_active === 1 })),
    categories: flat.map((c) => ({ id: c.id, parentId: c.parentId, name: c.name, depth: c.depth, path: c.path, isActive: c.isActive })),
    categoryAttributes: ((catAttrs!.results ?? []) as { category_id: string; attribute_id: string; is_required: number }[]).map((r) => ({
      categoryId: r.category_id, attributeId: r.attribute_id, isRequired: r.is_required === 1,
    })),
    attributes: ((attrs!.results ?? []) as { id: string; code: string; label: string; data_type: AttributeMeta["dataType"]; unit: string | null; is_variant_axis: number }[]).map((a) => ({
      id: a.id, code: a.code, label: a.label, dataType: a.data_type, unit: a.unit, isVariantAxis: a.is_variant_axis === 1,
      options: options.filter((o) => o.attribute_id === a.id).map((o) => ({ id: o.id, value: o.value_code, label: o.label, colorHex: o.color_hex })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Editor read model
// ---------------------------------------------------------------------------
export interface EditorVariant {
  id: string; sku: string; barcode: string | null; name: string | null; options: Record<string, string>;
  priceMinor: number; compareAtMinor: number | null; stock: number; reserved: number; isActive: boolean; isDefault: boolean;
  weightGrams: number | null; widthMm: number | null; heightMm: number | null; depthMm: number | null; locked: boolean;
}
export interface ProductEditorData {
  id: string; name: string; slug: string; status: ProductInput["status"]; shortDescription: string | null; descriptionHtml: string | null;
  taxRateBps: number; warrantyMonths: number | null; countryOfOrigin: string | null; accountingCode: string | null; manufacturerCode: string | null;
  brandId: string | null; publishedAt: string | null; createdAt: string; updatedAt: string;
  categories: { id: string; primary: boolean }[];
  media: { mediaId: string; url: string }[];
  primaryMediaId: string | null;
  axes: string[];
  variants: EditorVariant[];
  attributes: { attributeId: string; values: (string | number | boolean)[] }[];
  seo: { metaTitle: string | null; metaDescription: string | null; canonicalUrl: string | null; noindex: boolean };
}

export async function getProductEditor(id: string): Promise<ProductEditorData | null> {
  const db = await getDb();
  const [prodQ, catsQ, mediaQ, axesQ, varQ, voQ, pavQ, seoQ] = await db.batch([
    db.prepare("SELECT * FROM products WHERE id = ?").bind(id),
    db.prepare("SELECT category_id, is_primary FROM product_categories WHERE product_id = ? ORDER BY is_primary DESC").bind(id),
    db.prepare(`SELECT pm.media_id, m.public_url, pm.is_primary FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
                 WHERE pm.product_id = ? AND pm.variant_id IS NULL ORDER BY pm.sort_order, pm.id`).bind(id),
    db.prepare("SELECT attribute_id FROM product_variant_axes WHERE product_id = ? ORDER BY sort_order").bind(id),
    db.prepare(`SELECT v.*, vp.unit_price_minor, vp.compare_at_minor, COALESCE(ib.on_hand, 0) AS on_hand, COALESCE(ib.reserved, 0) AS reserved, ${LOCKED_SQL} AS locked
                  FROM product_variants v
                  LEFT JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?
                  LEFT JOIN inventory_balances ib ON ib.variant_id = v.id AND ib.warehouse_id = ?
                 WHERE v.product_id = ? ORDER BY v.is_default DESC, v.created_at, v.sku`).bind(DEFAULT_PRICE_LIST, WAREHOUSE_ID, id),
    db.prepare(`SELECT vo.variant_id, vo.attribute_id, vo.option_id FROM variant_options vo
                  JOIN product_variants v ON v.id = vo.variant_id WHERE v.product_id = ?`).bind(id),
    db.prepare("SELECT attribute_id, text_value, number_value, boolean_value, option_id FROM product_attribute_values WHERE product_id = ? ORDER BY attribute_id, value_index").bind(id),
    db.prepare("SELECT meta_title, meta_description, canonical_url, noindex FROM seo_documents WHERE product_id = ?").bind(id),
  ]);
  type P = { id: string; name: string; slug: string; status: ProductInput["status"]; short_description: string | null; description_html: string | null; tax_rate_bps: number; warranty_months: number | null; country_of_origin: string | null; accounting_code: string | null; manufacturer_code: string | null; brand_id: string | null; published_at: string | null; created_at: string; updated_at: string };
  const p = prodQ!.results?.[0] as P | undefined;
  if (!p) return null;

  type V = { id: string; sku: string; barcode: string | null; name: string | null; is_active: number; is_default: number; weight_grams: number | null; width_mm: number | null; height_mm: number | null; depth_mm: number | null; unit_price_minor: number | null; compare_at_minor: number | null; on_hand: number; reserved: number; locked: number };
  const vo = (voQ!.results ?? []) as { variant_id: string; attribute_id: string; option_id: string }[];
  const media = (mediaQ!.results ?? []) as { media_id: string; public_url: string; is_primary: number }[];

  const attrMap = new Map<string, (string | number | boolean)[]>();
  for (const r of (pavQ!.results ?? []) as { attribute_id: string; text_value: string | null; number_value: number | null; boolean_value: number | null; option_id: string | null }[]) {
    const v = r.option_id ?? r.text_value ?? r.number_value ?? (r.boolean_value == null ? null : r.boolean_value === 1);
    if (v == null) continue;
    attrMap.set(r.attribute_id, [...(attrMap.get(r.attribute_id) ?? []), v]);
  }
  const seo = seoQ!.results?.[0] as { meta_title: string | null; meta_description: string | null; canonical_url: string | null; noindex: number } | undefined;

  return {
    id: p.id, name: p.name, slug: p.slug, status: p.status, shortDescription: p.short_description, descriptionHtml: p.description_html,
    taxRateBps: p.tax_rate_bps, warrantyMonths: p.warranty_months, countryOfOrigin: p.country_of_origin, accountingCode: p.accounting_code,
    manufacturerCode: p.manufacturer_code, brandId: p.brand_id, publishedAt: p.published_at, createdAt: p.created_at, updatedAt: p.updated_at,
    categories: ((catsQ!.results ?? []) as { category_id: string; is_primary: number }[]).map((c) => ({ id: c.category_id, primary: c.is_primary === 1 })),
    media: media.map((m) => ({ mediaId: m.media_id, url: m.public_url })),
    primaryMediaId: media.find((m) => m.is_primary === 1)?.media_id ?? media[0]?.media_id ?? null,
    axes: ((axesQ!.results ?? []) as { attribute_id: string }[]).map((a) => a.attribute_id),
    variants: ((varQ!.results ?? []) as V[]).map((v) => ({
      id: v.id, sku: v.sku, barcode: v.barcode, name: v.name,
      options: Object.fromEntries(vo.filter((o) => o.variant_id === v.id).map((o) => [o.attribute_id, o.option_id])),
      priceMinor: v.unit_price_minor ?? 0, compareAtMinor: v.compare_at_minor, stock: v.on_hand, reserved: v.reserved,
      isActive: v.is_active === 1, isDefault: v.is_default === 1,
      weightGrams: v.weight_grams, widthMm: v.width_mm, heightMm: v.height_mm, depthMm: v.depth_mm, locked: v.locked === 1,
    })),
    attributes: [...attrMap.entries()].map(([attributeId, values]) => ({ attributeId, values })),
    seo: { metaTitle: seo?.meta_title ?? null, metaDescription: seo?.meta_description ?? null, canonicalUrl: seo?.canonical_url ?? null, noindex: seo?.noindex === 1 },
  };
}

// ---------------------------------------------------------------------------
// Save (create / update) — validated up-front, written in ONE D1 batch
// ---------------------------------------------------------------------------
type Errors = Record<string, string[]>;
const push = (e: Errors, k: string, m: string) => void (e[k] ??= []).push(m);

async function existingIds(db: D1Database, table: "brands" | "categories" | "media_assets", ids: string[], extra = ""): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const { results } = await db.prepare(`SELECT id FROM ${table} WHERE id IN (${placeholders(chunk.length)}) ${extra}`).bind(...chunk).all<{ id: string }>();
    for (const r of results ?? []) out.add(r.id);
  }
  return out;
}

async function takenElsewhere(db: D1Database, column: "sku" | "barcode", values: string[], productId: string | null): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < values.length; i += 80) {
    const chunk = values.slice(i, i + 80);
    const { results } = await db
      .prepare(`SELECT ${column} AS v FROM product_variants WHERE ${column} IN (${placeholders(chunk.length)}) AND (? IS NULL OR product_id <> ?)`)
      .bind(...chunk, productId, productId)
      .all<{ v: string }>();
    for (const r of results ?? []) out.add(r.v);
  }
  return out;
}

export async function saveProduct(productId: string | null, input: ProductInput, actor: { id: string; canPublish: boolean }) {
  const db = await getDb();
  const errors: Errors = {};
  const now = nowIso();

  // --- current state (update) ---
  type Cur = { status: string; published_at: string | null };
  const current = productId ? await db.prepare("SELECT status, published_at FROM products WHERE id = ?").bind(productId).first<Cur>() : null;
  if (productId && !current) throw new ApiError(404, "product_not_found", "Ürün bulunamadı.");
  type CurVar = { id: string; sku: string; combination_key: string; on_hand: number; reserved: number; has_balance: number; locked: number };
  const curVariants = productId
    ? ((await db
        .prepare(`SELECT v.id, v.sku, v.combination_key, COALESCE(ib.on_hand, 0) AS on_hand, COALESCE(ib.reserved, 0) AS reserved,
                         ib.variant_id IS NOT NULL AS has_balance, ${LOCKED_SQL} AS locked
                    FROM product_variants v LEFT JOIN inventory_balances ib ON ib.variant_id = v.id AND ib.warehouse_id = ?
                   WHERE v.product_id = ?`)
        .bind(WAREHOUSE_ID, productId)
        .all<CurVar>()).results ?? [])
    : [];
  const curById = new Map(curVariants.map((v) => [v.id, v]));
  const curMedia = productId
    ? ((await db.prepare("SELECT media_id FROM product_media WHERE product_id = ? AND variant_id IS NULL").bind(productId).all<{ media_id: string }>()).results ?? []).map((m) => m.media_id)
    : [];

  // --- general ---
  const slug = slugify(input.slug?.trim() || input.name);
  if (slug.length < 2) push(errors, "slug", "Geçerli bir slug girin.");
  else if (await db.prepare("SELECT 1 FROM products WHERE slug = ? AND (? IS NULL OR id <> ?)").bind(slug, productId, productId).first()) {
    push(errors, "slug", "Bu slug başka bir üründe kullanılıyor.");
  }
  const publishing = input.status === "published" && current?.status !== "published";
  if (publishing && !actor.canPublish) push(errors, "status", "Ürünü yayına almak için “catalog.publish” yetkisi gerekiyor.");

  // --- brand / categories ---
  if (input.brandId && !(await existingIds(db, "brands", [input.brandId])).size) push(errors, "brandId", "Marka bulunamadı.");
  const catIds = [...new Set(input.categories.map((c) => c.id))];
  const foundCats = await existingIds(db, "categories", catIds);
  for (const c of catIds) if (!foundCats.has(c)) push(errors, "categories", "Seçilen kategorilerden biri bulunamadı.");
  if (!catIds.length) push(errors, "categories", "En az bir kategori seçin.");
  const primaryCat = input.categories.find((c) => c.primary && foundCats.has(c.id))?.id ?? catIds.find((c) => foundCats.has(c)) ?? null;

  // --- media ---
  const mediaIds = [...new Set(input.media)];
  const foundMedia = await existingIds(db, "media_assets", mediaIds, "AND mime_type LIKE 'image/%'");
  if (mediaIds.some((m) => !foundMedia.has(m))) push(errors, "media", "Galerideki bir görsel bulunamadı; yeniden yükleyin.");
  const primaryMedia = input.primaryMediaId && mediaIds.includes(input.primaryMediaId) ? input.primaryMediaId : mediaIds[0] ?? null;
  if (input.status === "published" && !mediaIds.length) push(errors, "media", "Yayındaki bir ürün için en az bir görsel gerekli.");

  // --- attribute catalogue ---
  const meta = await getProductMeta();
  const attrById = new Map(meta.attributes.map((a) => [a.id, a]));
  const axes = [...new Set(input.axes)];
  for (const a of axes) if (!attrById.get(a)?.isVariantAxis) push(errors, "axes", "Seçilen eksen bir varyant ekseni değil.");

  // --- variants ---
  const keepIds = new Set<string>();
  const combos = new Map<string, number>();
  const skus = new Map<string, number>();
  const barcodes = new Map<string, number>();
  const prepared = input.variants.map((v, i) => {
    const k = (f: string) => `variants.${i}.${f}`;
    const cur = v.id ? curById.get(v.id) : undefined;
    if (v.id && !cur) push(errors, k("id"), "Varyant bu ürüne ait değil.");
    if (cur) keepIds.add(cur.id);

    const parts: string[] = [];
    for (const axisId of axes) {
      const attr = attrById.get(axisId);
      const optId = v.options[axisId];
      const opt = attr?.options.find((o) => o.id === optId);
      if (!attr) continue;
      if (!opt) push(errors, k(`options.${axisId}`), `${attr.label} seçin.`);
      else parts.push(`${attr.code}=${opt.value}`);
    }
    for (const key of Object.keys(v.options)) if (!axes.includes(key)) push(errors, k("options"), "Seçili olmayan bir eksen için değer gönderildi.");
    const combinationKey = axes.length ? parts.join(";") : "default";
    if (combos.has(combinationKey)) push(errors, k("options"), `Bu kombinasyon ${combos.get(combinationKey)! + 1}. varyantta da var.`);
    combos.set(combinationKey, i);

    const sku = v.sku.trim().toUpperCase();
    if (skus.has(sku)) push(errors, k("sku"), "SKU tekrar ediyor.");
    skus.set(sku, i);
    const barcode = v.barcode?.trim() || null;
    if (barcode) {
      if (barcodes.has(barcode)) push(errors, k("barcode"), "Barkod tekrar ediyor.");
      barcodes.set(barcode, i);
    }
    if (cur?.locked && (cur.sku !== sku || (axes.length && cur.combination_key !== combinationKey))) {
      push(errors, k("sku"), "Satılmış / stok hareketi olan varyantın SKU ve kombinasyonu değiştirilemez. Yeni varyant ekleyin.");
    }
    if (cur && v.stock < cur.reserved) push(errors, k("stock"), `Rezerve edilmiş ${cur.reserved} adetin altına düşürülemez.`);
    return { ...v, id: cur?.id ?? newId(), isNew: !cur, cur, sku, barcode, combinationKey };
  });
  if (!axes.length && prepared.length > 1) push(errors, "axes", "Birden fazla varyant için en az bir varyant ekseni (örn. Renk, Beden) seçin.");

  const skuTaken = await takenElsewhere(db, "sku", [...skus.keys()], productId);
  const barcodeTaken = await takenElsewhere(db, "barcode", [...barcodes.keys()], productId);
  prepared.forEach((v, i) => {
    if (skuTaken.has(v.sku)) push(errors, `variants.${i}.sku`, "Bu SKU başka bir üründe kullanılıyor.");
    if (v.barcode && barcodeTaken.has(v.barcode)) push(errors, `variants.${i}.barcode`, "Bu barkod başka bir üründe kullanılıyor.");
  });

  // Removed variants: delete if never used, otherwise archive (inactive) to keep the ledger intact.
  const removed = curVariants.filter((v) => !keepIds.has(v.id));
  const archive = removed.filter((v) => v.locked === 1 || v.reserved > 0);
  const destroy = removed.filter((v) => !(v.locked === 1 || v.reserved > 0));
  for (const a of archive) {
    if (combos.has(a.combination_key)) push(errors, `variants.${combos.get(a.combination_key)}.options`, `Bu kombinasyon arşivlenen ${a.sku} varyantında kayıtlı.`);
  }

  const defaultIdx = Math.max(0, prepared.findIndex((v) => v.isDefault && v.isActive)) ;
  const defaultId = prepared[defaultIdx]?.id ?? prepared[0]!.id;

  // --- attributes (axes of this product are SKU data, not specs) ---
  type PavRow = { attributeId: string; index: number; text: string | null; number: number | null; bool: number | null; option: string | null };
  const pav: PavRow[] = [];
  input.attributes.forEach((a, i) => {
    const attr = attrById.get(a.attributeId);
    if (!attr) return push(errors, `attributes.${i}`, "Özellik bulunamadı.");
    if (axes.includes(attr.id)) return;
    const vals = a.values.filter((v) => v !== "" && v != null);
    const list = attr.dataType === "multiselect" ? vals : vals.slice(0, 1);
    list.forEach((raw, index) => {
      const row: PavRow = { attributeId: attr.id, index, text: null, number: null, bool: null, option: null };
      if (attr.dataType === "text") row.text = String(raw).slice(0, 500);
      else if (attr.dataType === "number") {
        const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
        if (!Number.isFinite(n)) return push(errors, `attributes.${attr.id}`, `${attr.label} sayı olmalı.`);
        row.number = n;
      } else if (attr.dataType === "boolean") row.bool = raw === true || raw === "true" || raw === 1 ? 1 : 0;
      else {
        if (!attr.options.some((o) => o.id === raw)) return push(errors, `attributes.${attr.id}`, `${attr.label} için geçersiz seçenek.`);
        row.option = String(raw);
      }
      pav.push(row);
    });
  });

  // Attributes the selected categories (or their ancestors) mark as required; variant axes satisfy them via SKUs.
  for (const attrId of requiredAttributeIds(meta, catIds.filter((c) => foundCats.has(c)))) {
    if (axes.includes(attrId) || pav.some((r) => r.attributeId === attrId)) continue;
    push(errors, `attributes.${attrId}`, `${attrById.get(attrId)?.label ?? "Özellik"} bu kategori için zorunlu.`);
  }

  if (Object.keys(errors).length) throw new ApiError(422, "validation_error", "Kaydedilemedi: işaretli alanları kontrol edin.", errors);

  // ------------------------------------------------------------------ batch
  const id = productId ?? newId();
  const s: D1PreparedStatement[] = [];
  const publishedAt = current?.published_at ?? (input.status === "published" ? now : null);
  const country = input.countryOfOrigin ? input.countryOfOrigin.toUpperCase() : null;
  const productValues = [input.brandId ?? null, input.name.trim(), slug, input.shortDescription?.trim() || null, input.descriptionHtml?.trim() || null,
    input.accountingCode?.trim() || null, input.manufacturerCode?.trim() || null, input.status, input.taxRateBps, input.warrantyMonths ?? null, country, publishedAt];

  if (productId) {
    s.push(db.prepare(`UPDATE products SET brand_id = ?, name = ?, slug = ?, short_description = ?, description_html = ?, accounting_code = ?, manufacturer_code = ?,
                              status = ?, tax_rate_bps = ?, warranty_months = ?, country_of_origin = ?, published_at = ?, updated_at = ? WHERE id = ?`)
      .bind(...productValues, now, id));
  } else {
    s.push(db.prepare(`INSERT INTO products (brand_id, name, slug, short_description, description_html, accounting_code, manufacturer_code,
                              status, tax_rate_bps, warranty_months, country_of_origin, published_at, created_at, updated_at, id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(...productValues, now, now, id));
  }

  // categories
  s.push(db.prepare("DELETE FROM product_categories WHERE product_id = ?").bind(id));
  for (const c of catIds.filter((c) => foundCats.has(c))) {
    s.push(db.prepare("INSERT INTO product_categories (product_id, category_id, is_primary) VALUES (?, ?, ?)").bind(id, c, c === primaryCat ? 1 : 0));
  }

  // gallery
  s.push(db.prepare("DELETE FROM product_media WHERE product_id = ? AND variant_id IS NULL").bind(id));
  mediaIds.forEach((m, i) => {
    s.push(db.prepare("INSERT INTO product_media (id, product_id, variant_id, media_id, sort_order, is_primary) VALUES (?, ?, NULL, ?, ?, ?)").bind(newId(), id, m, i, m === primaryMedia ? 1 : 0));
  });

  // axes + variant options are rebuilt; variants are updated in place (ids are stable)
  s.push(db.prepare("DELETE FROM variant_options WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ?)").bind(id));
  s.push(db.prepare("DELETE FROM product_variant_axes WHERE product_id = ?").bind(id));
  axes.forEach((a, i) => s.push(db.prepare("INSERT INTO product_variant_axes (product_id, attribute_id, sort_order) VALUES (?, ?, ?)").bind(id, a, i)));

  for (const v of destroy) {
    s.push(db.prepare("DELETE FROM inventory_balances WHERE variant_id = ?").bind(v.id), db.prepare("DELETE FROM product_variants WHERE id = ? AND product_id = ?").bind(v.id, id));
  }
  for (const v of archive) {
    s.push(db.prepare("UPDATE product_variants SET is_active = 0, is_default = 0, updated_at = ? WHERE id = ?").bind(now, v.id));
  }
  // Free unique slots (one default per product, unique combination per product) before rewriting.
  s.push(db.prepare("UPDATE product_variants SET is_default = 0 WHERE product_id = ?").bind(id));
  const kept = prepared.filter((v) => !v.isNew).map((v) => v.id);
  if (kept.length) {
    for (let i = 0; i < kept.length; i += 80) {
      const chunk = kept.slice(i, i + 80);
      s.push(db.prepare(`UPDATE product_variants SET combination_key = 'tmp:' || id WHERE id IN (${placeholders(chunk.length)})`).bind(...chunk));
    }
  }

  for (const v of prepared) {
    const cols = [v.sku, v.barcode, v.name?.trim() || null, v.combinationKey, v.weightGrams ?? null, v.widthMm ?? null, v.heightMm ?? null, v.depthMm ?? null,
      v.isActive ? 1 : 0, v.id === defaultId ? 1 : 0];
    if (v.isNew) {
      s.push(db.prepare(`INSERT INTO product_variants (sku, barcode, name, combination_key, weight_grams, width_mm, height_mm, depth_mm, is_active, is_default, created_at, updated_at, id, product_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...cols, now, now, v.id, id));
    } else {
      s.push(db.prepare(`UPDATE product_variants SET sku = ?, barcode = ?, name = ?, combination_key = ?, weight_grams = ?, width_mm = ?, height_mm = ?, depth_mm = ?,
                                is_active = ?, is_default = ?, updated_at = ? WHERE id = ? AND product_id = ?`).bind(...cols, now, v.id, id));
    }
    s.push(db.prepare(`INSERT INTO variant_prices (variant_id, price_list_id, unit_price_minor, compare_at_minor, updated_at) VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT(variant_id, price_list_id) DO UPDATE SET unit_price_minor = excluded.unit_price_minor,
                                compare_at_minor = excluded.compare_at_minor, updated_at = excluded.updated_at`)
      .bind(v.id, DEFAULT_PRICE_LIST, v.priceMinor, v.compareAtMinor ?? null, now));

    // stock: balance + append-only movement in the same transaction (spec §05)
    const hasBalance = v.cur?.has_balance === 1;
    const delta = v.stock - (hasBalance ? v.cur!.on_hand : 0);
    if (!hasBalance) {
      s.push(db.prepare("INSERT INTO inventory_balances (variant_id, warehouse_id, on_hand, reserved) VALUES (?, ?, ?, 0)").bind(v.id, WAREHOUSE_ID, v.stock));
    } else if (delta !== 0) {
      s.push(db.prepare("UPDATE inventory_balances SET on_hand = ?, version = version + 1, updated_at = ? WHERE variant_id = ? AND warehouse_id = ?").bind(v.stock, now, v.id, WAREHOUSE_ID));
    }
    if (delta !== 0) {
      s.push(db.prepare(`INSERT INTO inventory_movements (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, reason, actor_id, idempotency_key)
                         VALUES (?, ?, ?, ?, ?, 0, 'product', ?, 'Panelden stok güncelleme', ?, ?)`)
        .bind(newId(), v.id, WAREHOUSE_ID, hasBalance ? "adjustment" : "receipt", delta, id, actor.id, `mv:panel:${v.id}:${newId()}`));
    }
    for (const axisId of axes) {
      s.push(db.prepare("INSERT INTO variant_options (variant_id, attribute_id, option_id) VALUES (?, ?, ?)").bind(v.id, axisId, v.options[axisId]!));
    }
  }

  // specs
  s.push(db.prepare("DELETE FROM product_attribute_values WHERE product_id = ?").bind(id));
  for (const r of pav) {
    s.push(db.prepare(`INSERT INTO product_attribute_values (id, product_id, attribute_id, value_index, text_value, number_value, boolean_value, option_id)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(newId(), id, r.attributeId, r.index, r.text, r.number, r.bool, r.option));
  }

  // SEO (one document per product)
  const seo = input.seo;
  const seoTitle = seo.metaTitle?.trim() || null, seoDesc = seo.metaDescription?.trim() || null, canonical = seo.canonicalUrl?.trim() || null;
  if (seoTitle || seoDesc || canonical || seo.noindex) {
    s.push(db.prepare(`INSERT INTO seo_documents (id, product_id, meta_title, meta_description, canonical_url, noindex) VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT(product_id) DO UPDATE SET meta_title = excluded.meta_title, meta_description = excluded.meta_description,
                                canonical_url = excluded.canonical_url, noindex = excluded.noindex`)
      .bind(newId(), id, seoTitle, seoDesc, canonical, seo.noindex ? 1 : 0));
  } else {
    s.push(db.prepare("DELETE FROM seo_documents WHERE product_id = ?").bind(id));
  }

  await db.batch(s);

  for (const m of curMedia.filter((m) => !mediaIds.includes(m))) await releaseMedia(m);
  return { id, slug, archivedVariants: archive.map((v) => v.sku), deletedVariants: destroy.map((v) => v.sku) };
}

/** Hard delete only for products that never sold / moved stock; otherwise the caller should archive (status = archived). */
export async function deleteProduct(id: string) {
  const db = await getDb();
  const p = await db.prepare("SELECT name, slug FROM products WHERE id = ?").bind(id).first<{ name: string; slug: string }>();
  if (!p) throw new ApiError(404, "product_not_found", "Ürün bulunamadı.");
  const locked = await db.prepare(`SELECT COUNT(*) AS n FROM product_variants v WHERE v.product_id = ? AND ${LOCKED_SQL}`).bind(id).first<{ n: number }>();
  if ((locked?.n ?? 0) > 0) {
    throw new ApiError(409, "product_has_history", "Bu ürünün sipariş veya stok geçmişi var; silinemez. Durumunu “Arşivlendi” yapın.");
  }
  const media = ((await db.prepare("SELECT media_id FROM product_media WHERE product_id = ?").bind(id).all<{ media_id: string }>()).results ?? []).map((m) => m.media_id);
  await db.batch([
    db.prepare("DELETE FROM inventory_balances WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = ?)").bind(id),
    db.prepare("DELETE FROM product_variants WHERE product_id = ?").bind(id),
    db.prepare("DELETE FROM products WHERE id = ?").bind(id),
  ]);
  for (const m of media) await releaseMedia(m);
  return p;
}
