import { isAppError, type Logger } from "@/core";
import { formatMinor } from "@/lib/money";
import type { ProductActor, ProductEditorData, ProductInput, ProductMeta, SavedProduct } from "@/modules/catalog";
import type { UploadedImage } from "@/modules/media";
import {
  BULK_FIELDS, normalizeRow, resolveBrand, resolveCategory, type BulkOp, type MatchKey, type NormalizedRow, type RawRow, type RowResult, type RowValues,
} from "../domain/bulk";
import type { FeedField, FeedOptions } from "../domain/feed";
import type { LocatedProduct, ProductLocator, RemoteFetcher } from "./ports";

/** What the engine needs from the catalog and media modules (wired in module.ts). */
export interface CatalogGateway {
  meta(): Promise<ProductMeta>;
  editor(productId: string): Promise<ProductEditorData | null>;
  /** null = the save would succeed, else field → messages (nothing written). */
  check(productId: string | null, input: ProductInput, actor: ProductActor): Promise<Record<string, string[]> | null>;
  create(input: ProductInput, actor: ProductActor): Promise<SavedProduct>;
  update(productId: string, input: ProductInput, actor: ProductActor): Promise<SavedProduct>;
  /** Shape / range check of a save payload (the route schema). */
  parse(input: unknown): { ok: true; input: ProductInput } | { ok: false; errors: string[] };
  uploadImage(bytes: Uint8Array, fileName: string, actor: ProductActor): Promise<UploadedImage>;
}

export interface EngineContext {
  op: BulkOp | "feed";
  matchKey: MatchKey | null;
  actor: ProductActor;
  /** false = check only (dry run), true = write. */
  apply: boolean;
  imageMode: "replace" | "append";
  /** Feed runs: what to do with unknown products and which fields may change existing ones. */
  feed?: Pick<FeedOptions, "createMissing" | "defaultCategoryId" | "newStatus" | "updateFields">;
}

const IMAGE_BYTES = 5 * 1024 * 1024;
const tl = (m: number | null | undefined) => (m == null ? "—" : formatMinor(m));
const pct = (bps: number) => `%${(bps / 100).toLocaleString("tr-TR")}`;
const STATUS_TR: Record<string, string> = { draft: "Taslak", in_review: "İncelemede", published: "Yayında", paused: "Pasif", archived: "Arşiv" };

/** Editor data → the save payload the panel would send for an unchanged product. */
export function toSaveInput(d: ProductEditorData): ProductInput {
  return {
    name: d.name, slug: d.slug, status: d.status, shortDescription: d.shortDescription, descriptionHtml: d.descriptionHtml, taxRateBps: d.taxRateBps,
    warrantyMonths: d.warrantyMonths, countryOfOrigin: d.countryOfOrigin, accountingCode: d.accountingCode, manufacturerCode: d.manufacturerCode,
    brandId: d.brandId, categories: d.categories, media: d.media.map((m) => m.mediaId), primaryMediaId: d.primaryMediaId, axes: d.axes,
    variants: d.variants.map((v) => ({
      id: v.id, sku: v.sku, barcode: v.barcode, name: v.name, options: v.options, priceMinor: v.priceMinor, compareAtMinor: v.compareAtMinor,
      minPriceMinor: v.minPriceMinor, stock: v.stock, expectedStock: v.stock, isActive: v.isActive, isDefault: v.isDefault,
      weightGrams: v.weightGrams, widthMm: v.widthMm, heightMm: v.heightMm, depthMm: v.depthMm,
    })),
    attributes: d.attributes.filter((a) => !d.axes.includes(a.attributeId)),
    seo: d.seo,
    expectedUpdatedAt: d.updatedAt,
  };
}

/** Readable list of field errors of a failed check / save. */
function messagesOf(errors: Record<string, string[]>): string[] {
  return [...new Set(Object.values(errors).flat())];
}

/**
 * Row engine shared by every Excel tab and every feed sync: normalise → find the product → patch the editor payload
 * → check (dry run) or save through the catalog use cases. One row never stops the others; its result says why.
 */
export class RowEngine {
  constructor(private readonly catalog: CatalogGateway, private readonly locator: ProductLocator, private readonly fetcher: RemoteFetcher, private readonly logger: Logger) {}

  async run(rows: (RawRow | NormalizedRow)[], ctx: EngineContext): Promise<RowResult[]> {
    const normalized = rows.map((r) => ("values" in r ? r : normalizeRow(ctx.op, r)));
    const meta = await this.catalog.meta();
    const keys = normalized.filter((r) => r.key && !r.errors.length).map((r) => r.key!);
    const located = ctx.matchKey && keys.length ? await this.locator.locate(ctx.matchKey, keys) : new Map<string, LocatedProduct[]>();
    const seen = new Map<string, number>();
    const out: RowResult[] = [];
    for (const row of normalized) {
      // a new product has no key yet: its SKU identifies the row
      const base: RowResult = { line: row.line, key: row.key ?? (ctx.op === "create" ? row.values.sku ?? null : null), status: "error", productId: null, productName: null, messages: [] };
      if (row.errors.length) { out.push({ ...base, messages: row.errors }); continue; }
      const dupKey = row.key ?? (ctx.op === "create" ? row.values.sku ?? null : null);
      if (dupKey) {
        const first = seen.get(dupKey);
        if (first !== undefined) { out.push({ ...base, messages: [`Aynı ${ctx.op === "create" ? "SKU" : "anahtar"} ${first}. satırda da var.`] }); continue; }
        seen.set(dupKey, row.line);
      }
      try {
        out.push(await this.one(row, located, meta, ctx));
      } catch (e) {
        const messages = isAppError(e) ? (e.fieldErrors && Object.keys(e.fieldErrors).length ? messagesOf(e.fieldErrors) : [e.message]) : ["Beklenmeyen bir hata oluştu."];
        if (!isAppError(e)) this.logger.error("bulk row failed", { line: row.line, error: String(e), stack: e instanceof Error ? e.stack : undefined });
        out.push({ ...base, messages });
      }
    }
    return out;
  }

  private async one(row: NormalizedRow, located: Map<string, LocatedProduct[]>, meta: ProductMeta, ctx: EngineContext): Promise<RowResult> {
    const base: RowResult = { line: row.line, key: row.key ?? (ctx.op === "create" ? row.values.sku ?? null : null), status: "error", productId: null, productName: null, messages: [] };
    if (ctx.op === "create") return this.create(row, meta, ctx, base);

    const hits = row.key ? located.get(row.key) ?? [] : [];
    const products = [...new Set(hits.map((h) => h.productId))];
    if (!products.length) {
      if (ctx.op === "feed" && ctx.feed?.createMissing) return this.create(row, meta, ctx, base);
      if (ctx.op === "feed") return { ...base, status: "unchanged", messages: ["Mağazada yok; atlandı (yeni ürün oluşturma kapalı)."] };
      return { ...base, messages: [`Bu ${ctx.matchKey ? "anahtarla" : "satırla"} eşleşen ürün yok.`] };
    }
    if (products.length > 1) return { ...base, messages: [`Anahtar ${products.length} farklı üründe kayıtlı; daha ayırt edici bir anahtar seçin (barkod veya SKU).`] };

    const editor = await this.catalog.editor(products[0]!);
    if (!editor) return { ...base, messages: ["Ürün bulunamadı (silinmiş olabilir)."] };
    const result: RowResult = { ...base, productId: editor.id, productName: editor.name };
    const input = toSaveInput(editor);
    const changes: string[] = [];
    const v = row.values;
    const allowed = (f: FeedField) => ctx.op !== "feed" || ctx.feed!.updateFields.includes(f);

    // --- product-level fields
    const setText = (f: "name" | "shortDescription" | "description", target: "name" | "shortDescription" | "descriptionHtml") => {
      const nv = v[f];
      if (nv === undefined || !allowed(f) || nv === (input[target] ?? "")) return;
      changes.push(f === "description" ? "Açıklama güncellenir" : `${BULK_FIELDS[f].label}: “${(input[target] ?? "").slice(0, 40)}” → “${nv.slice(0, 40)}”`);
      (input as Record<string, unknown>)[target] = nv;
    };
    if (ctx.op === "update" || ctx.op === "feed") {
      setText("name", "name"); setText("shortDescription", "shortDescription"); setText("description", "descriptionHtml");
      if (v.brand !== undefined && allowed("brand")) {
        const b = resolveBrand(v.brand, meta.brands);
        if (b.error) { if (ctx.op !== "feed") return { ...result, messages: [b.error] }; }
        else if (b.id !== input.brandId) { changes.push(`Marka: ${meta.brands.find((x) => x.id === input.brandId)?.name ?? "—"} → ${v.brand}`); input.brandId = b.id; }
      }
      if (v.category !== undefined && allowed("category")) {
        const c = resolveCategory(v.category, meta.categories);
        if (c.error) { if (ctx.op !== "feed") return { ...result, messages: [c.error] }; }
        else if (input.categories.find((x) => x.primary)?.id !== c.id) {
          changes.push(`Ana kategori → ${meta.categories.find((x) => x.id === c.id)?.path}`);
          input.categories = [{ id: c.id!, primary: true }, ...input.categories.filter((x) => x.id !== c.id).map((x) => ({ ...x, primary: false }))];
        }
      }
      if (v.taxRateBps !== undefined && allowed("taxRate") && v.taxRateBps !== input.taxRateBps) { changes.push(`KDV: ${pct(input.taxRateBps)} → ${pct(v.taxRateBps)}`); input.taxRateBps = v.taxRateBps; }
      if (v.status !== undefined && ctx.op === "update" && v.status !== input.status) { changes.push(`Durum: ${STATUS_TR[input.status]} → ${STATUS_TR[v.status]}`); input.status = v.status; }
      for (const [f, target] of [["accountingCode", "accountingCode"], ["manufacturerCode", "manufacturerCode"]] as const) {
        if (v[f] !== undefined && ctx.op === "update" && v[f] !== (input[target] ?? "")) { changes.push(`${BULK_FIELDS[f].label}: ${input[target] ?? "—"} → ${v[f]}`); input[target] = v[f]!; }
      }
    }

    // --- variant-level fields (price, stock)
    const wantsPrice = (v.priceMinor !== undefined && allowed("price")) || (v.compareAtMinor !== undefined && allowed("compareAt")) || v.minPriceMinor !== undefined;
    const wantsStock = v.stock !== undefined && allowed("stock");
    if ((ctx.op === "prices" || ctx.op === "stock" || ctx.op === "feed") && (wantsPrice || wantsStock)) {
      const variantId = hits[0]!.variantId;
      const active = input.variants.filter((x) => x.isActive);
      const target = variantId ? input.variants.find((x) => x.id === variantId) : active.length === 1 ? active[0] : undefined;
      if (!target) return { ...result, messages: ["Ürünün birden çok varyantı var; fiyat ve stok için barkod veya SKU ile eşleştirin."] };
      if (wantsPrice) {
        if (v.priceMinor !== undefined && allowed("price") && v.priceMinor !== target.priceMinor) { changes.push(`Fiyat: ${tl(target.priceMinor)} → ${tl(v.priceMinor)}`); target.priceMinor = v.priceMinor; }
        if (v.compareAtMinor !== undefined && allowed("compareAt") && v.compareAtMinor !== (target.compareAtMinor ?? null)) {
          changes.push(`Eski fiyat: ${tl(target.compareAtMinor)} → ${tl(v.compareAtMinor)}`); target.compareAtMinor = v.compareAtMinor;
        }
        if (v.minPriceMinor !== undefined && v.minPriceMinor !== (target.minPriceMinor ?? null)) { changes.push(`Taban fiyat: ${tl(target.minPriceMinor)} → ${tl(v.minPriceMinor)}`); target.minPriceMinor = v.minPriceMinor; }
        // a feed is the source of truth: a stale old price that is no longer above the price is dropped instead of failing
        if (ctx.op === "feed" && target.compareAtMinor != null && target.compareAtMinor <= target.priceMinor) { changes.push("Eski fiyat kaldırılır"); target.compareAtMinor = null; }
      }
      if (wantsStock && v.stock !== target.stock) { changes.push(`Stok: ${target.stock} → ${v.stock}`); target.stock = v.stock!; }
    }

    // --- images
    if ((ctx.op === "images" || ctx.op === "feed") && v.images?.length && allowed("images")) {
      changes.push(`${v.images.length} görsel ${ctx.imageMode === "append" ? "eklenir" : "galerinin yerine geçer"}`);
      if (ctx.apply) {
        const imported = await this.importImages(v.images, ctx.actor);
        if (!imported.ids.length) return { ...result, messages: imported.errors };
        input.media = ctx.imageMode === "append" ? [...new Set([...input.media, ...imported.ids])].slice(0, 30) : imported.ids;
        input.primaryMediaId = ctx.imageMode === "append" && input.primaryMediaId ? input.primaryMediaId : input.media[0] ?? null;
        changes.push(...imported.errors);
      }
    }

    if (!changes.length) return { ...result, status: "unchanged", messages: ["Değişiklik yok."] };
    const parsed = this.catalog.parse(input);
    if (!parsed.ok) return { ...result, messages: parsed.errors };
    if (!ctx.apply) {
      const errors = await this.catalog.check(editor.id, parsed.input, ctx.actor);
      return errors ? { ...result, messages: messagesOf(errors) } : { ...result, status: "ok", messages: changes };
    }
    await this.catalog.update(editor.id, parsed.input, ctx.actor);
    return { ...result, status: "updated", messages: changes };
  }

  private async create(row: NormalizedRow, meta: ProductMeta, ctx: EngineContext, base: RowResult): Promise<RowResult> {
    const v: RowValues = row.values;
    const isFeed = ctx.op === "feed";
    const missing = [!v.name && "ürün adı", v.priceMinor == null && "fiyat", !v.sku && !row.key && "SKU"].filter(Boolean);
    if (missing.length) return { ...base, messages: [`Yeni ürün için ${missing.join(", ")} gerekli.`] };
    let categoryId = isFeed ? ctx.feed?.defaultCategoryId ?? null : null;
    if (v.category) {
      const c = resolveCategory(v.category, meta.categories);
      if (c.id) categoryId = c.id;
      else if (!isFeed || !categoryId) return { ...base, messages: [c.error!] };
    }
    if (!categoryId) return { ...base, messages: ["Yeni ürün için kategori gerekli (kaynak ayarlarında varsayılan kategori seçin)."] };
    let brandId: string | null = null;
    if (v.brand) {
      const b = resolveBrand(v.brand, meta.brands);
      if (b.id) brandId = b.id;
      else if (!isFeed) return { ...base, messages: [b.error!] };
    }
    // feeds keyed by barcode / codes still need a SKU: the key itself (cleaned) when the feed has none
    const sku = (v.sku ?? row.key ?? "").toUpperCase().replace(/[^A-Z0-9._-]/g, "-").slice(0, 64);
    const keyField = ctx.matchKey === "barcode" ? "barcode" : ctx.matchKey === "accounting_code" ? "accountingCode" : ctx.matchKey === "manufacturer_code" ? "manufacturerCode" : null;
    const status = isFeed ? ctx.feed!.newStatus : v.status ?? "draft";
    const messages = [`Yeni ürün: ${v.name} · ${tl(v.priceMinor)} · stok ${v.stock ?? 0}`];

    let media: string[] = [];
    if (v.images?.length) {
      messages.push(`${v.images.length} görsel indirilir`);
      if (ctx.apply) {
        const imported = await this.importImages(v.images, ctx.actor);
        media = imported.ids;
        messages.push(...imported.errors);
      }
    }
    const raw = {
      name: v.name, status, shortDescription: v.shortDescription ?? null, descriptionHtml: v.description ?? null, taxRateBps: v.taxRateBps ?? 2000,
      warrantyMonths: null, countryOfOrigin: null,
      accountingCode: v.accountingCode ?? (keyField === "accountingCode" ? row.key : null), manufacturerCode: v.manufacturerCode ?? (keyField === "manufacturerCode" ? row.key : null),
      brandId, categories: [{ id: categoryId, primary: true }], media, primaryMediaId: media[0] ?? null, axes: [],
      variants: [{
        sku, barcode: v.barcode ?? (keyField === "barcode" ? row.key : null), name: null, options: {}, priceMinor: v.priceMinor,
        compareAtMinor: v.compareAtMinor != null && v.compareAtMinor > v.priceMinor! ? v.compareAtMinor : null, minPriceMinor: v.minPriceMinor ?? null,
        stock: v.stock ?? 0, isActive: true, isDefault: true,
      }],
      attributes: [], seo: { metaTitle: null, metaDescription: null, canonicalUrl: null, noindex: false },
    };
    const parsed = this.catalog.parse(raw);
    if (!parsed.ok) return { ...base, messages: parsed.errors };
    if (!ctx.apply) {
      const errors = await this.catalog.check(null, parsed.input, ctx.actor);
      // images are only downloaded on "Yükle"; a published product's "needs an image" rule is checked then
      if (errors && v.images?.length) delete errors.media;
      return errors && Object.keys(errors).length ? { ...base, messages: messagesOf(errors) } : { ...base, status: "ok", productName: v.name!, messages };
    }
    const saved = await this.catalog.create(parsed.input, ctx.actor);
    return { ...base, status: "created", productId: saved.id, productName: v.name!, messages };
  }

  /** Downloads images and stores them like panel uploads (type sniffed from the bytes, 5 MB, no SVG). */
  async importImages(urls: string[], actor: ProductActor): Promise<{ ids: string[]; errors: string[] }> {
    const ids: string[] = [], errors: string[] = [];
    for (const url of urls) {
      try {
        const bytes = await this.fetcher.bytes(url, { maxBytes: IMAGE_BYTES, timeoutMs: 15_000 });
        const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "gorsel").slice(0, 100);
        ids.push((await this.catalog.uploadImage(bytes, name, actor)).id);
      } catch (e) {
        errors.push(`Görsel alınamadı (${url.slice(0, 60)}): ${isAppError(e) ? e.message : "bilinmeyen hata"}`);
      }
    }
    return { ids, errors };
  }
}
