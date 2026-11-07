import { isAppError, type Logger } from "@/core";
import { formatMinor } from "@/lib/money";
import type { ProductActor, ProductEditorData, ProductInput, ProductMeta, SavedProduct } from "@/modules/catalog";
import { findOption } from "@/modules/catalog/domain/attribute";
import type { UploadedImage } from "@/modules/media";
import {
  BULK_FIELDS, MAX_VARIANTS_PER_MODEL, groupKeyOf, normalizeRow, resolveBrand, resolveCategory,
  type BulkOp, type MatchKey, type NormalizedRow, type RawRow, type RowResult, type RowValues,
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
    modelCode: d.modelCode, brandId: d.brandId, categories: d.categories, media: d.media.map((m) => m.mediaId), primaryMediaId: d.primaryMediaId, axes: d.axes,
    variants: d.variants.map((v) => ({
      id: v.id, sku: v.sku, barcode: v.barcode, name: v.name, options: v.options, priceMinor: v.priceMinor, compareAtMinor: v.compareAtMinor,
      minPriceMinor: v.minPriceMinor, stock: v.stock, expectedStock: v.stock, isActive: v.isActive, isDefault: v.isDefault,
      weightGrams: v.weightGrams, widthMm: v.widthMm, heightMm: v.heightMm, depthMm: v.depthMm, media: v.media.map((m) => m.mediaId),
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

/** Errors of a model save split by row: `variants.N.*` belongs to variant N, everything else to every row. */
function messagesByVariant(errors: Record<string, string[]>): { all: string[]; byIndex: Map<number, string[]> } {
  const all: string[] = [];
  const byIndex = new Map<number, string[]>();
  for (const [k, msgs] of Object.entries(errors)) {
    const m = /^variants\.(\d+)\./.exec(k);
    if (m) byIndex.set(Number(m[1]), [...new Set([...(byIndex.get(Number(m[1])) ?? []), ...msgs])]);
    else all.push(...msgs);
  }
  return { all: [...new Set(all)], byIndex };
}

const failureMessages = (e: unknown) =>
  isAppError(e) ? (e.fieldErrors && Object.keys(e.fieldErrors).length ? messagesOf(e.fieldErrors) : [e.message]) : ["Beklenmeyen bir hata oluştu."];

/**
 * Row engine shared by every Excel tab and every feed sync: normalise → find the product → patch the editor payload
 * → check (dry run) or save through the catalog use cases. One row never stops the others; its result says why.
 */
export class RowEngine {
  constructor(private readonly catalog: CatalogGateway, private readonly locator: ProductLocator, private readonly fetcher: RemoteFetcher, private readonly logger: Logger) {}

  async run(rows: (RawRow | NormalizedRow)[], ctx: EngineContext): Promise<RowResult[]> {
    const normalized = rows.map((r) => ("values" in r ? r : normalizeRow(ctx.op, r)));
    const meta = await this.catalog.meta();
    if (ctx.op === "create") return this.runCreate(normalized, meta, ctx);
    const keys = normalized.filter((r) => r.key && !r.errors.length).map((r) => r.key!);
    const located = ctx.matchKey && keys.length ? await this.locator.locate(ctx.matchKey, keys) : new Map<string, LocatedProduct[]>();
    const seen = new Map<string, number>();
    const out: RowResult[] = [];
    for (const row of normalized) {
      const base: RowResult = { line: row.line, key: row.key, status: "error", productId: null, productName: null, messages: [] };
      if (row.errors.length) { out.push({ ...base, messages: row.errors }); continue; }
      const dupKey = row.key;
      if (dupKey) {
        const first = seen.get(dupKey);
        if (first !== undefined) { out.push({ ...base, messages: [`Aynı anahtar ${first}. satırda da var.`] }); continue; }
        seen.set(dupKey, row.line);
      }
      try {
        out.push(await this.one(row, located, meta, ctx));
      } catch (e) {
        if (!isAppError(e)) this.logger.error("bulk row failed", { line: row.line, error: String(e), stack: e instanceof Error ? e.stack : undefined });
        out.push({ ...base, messages: failureMessages(e) });
      }
    }
    return out;
  }

  /**
   * "Ürün ekle": rows sharing a model code are one product (each row a variant); a model code that already exists adds
   * the rows as new variants of that product. A model is written all-or-nothing, so its rows always travel in one chunk.
   */
  private async runCreate(rows: NormalizedRow[], meta: ProductMeta, ctx: EngineContext): Promise<RowResult[]> {
    const base = (r: NormalizedRow): RowResult => ({ line: r.line, key: r.values.sku ?? null, status: "error", productId: null, productName: null, messages: [] });
    const seen = new Map<string, number>();
    const checked = rows.map((r) => {
      const sku = r.values.sku;
      if (!sku || r.errors.length) return r;
      const first = seen.get(sku);
      if (first !== undefined) return { ...r, errors: [`Aynı SKU ${first}. satırda da var.`] };
      seen.set(sku, r.line);
      return r;
    });
    const groups = new Map<string, NormalizedRow[]>();
    for (const r of checked) groups.set(groupKeyOf(r), [...(groups.get(groupKeyOf(r)) ?? []), r]);
    const codes = [...new Set(checked.map((r) => r.values.modelCode).filter((c): c is string => Boolean(c)))];
    const existing = codes.length ? await this.locator.locate("model_code", codes) : new Map<string, LocatedProduct[]>();

    const out = new Map<number, RowResult>();
    for (const group of groups.values()) {
      const first = group[0]!;
      let results: RowResult[];
      try {
        if (group.length === 1 && !first.values.modelCode && !first.values.variant) {
          results = [first.errors.length ? { ...base(first), messages: first.errors } : await this.create(first, meta, ctx, base(first))];
        } else {
          results = await this.createModel(group, existing.get(first.values.modelCode ?? "")?.[0]?.productId ?? null, meta, ctx, base);
        }
      } catch (e) {
        if (!isAppError(e)) this.logger.error("bulk model failed", { line: first.line, error: String(e), stack: e instanceof Error ? e.stack : undefined });
        results = group.map((r) => ({ ...base(r), messages: failureMessages(e) }));
      }
      for (const r of results) out.set(r.line, r);
    }
    return checked.map((r) => out.get(r.line)!);
  }

  /** One model: new product with these rows as variants, or new variants of the product that has the model code. */
  private async createModel(rows: NormalizedRow[], existingId: string | null, meta: ProductMeta, ctx: EngineContext, base: (r: NormalizedRow) => RowResult): Promise<RowResult[]> {
    const code = rows[0]!.values.modelCode;
    const refuse = (byRow: Map<number, string[]>, others: string) =>
      rows.map((r) => ({ ...base(r), messages: byRow.get(r.line) ?? [others] }));
    const all = (msg: string) => rows.map((r) => ({ ...base(r), messages: [msg] }));

    const bad = rows.filter((r) => r.errors.length);
    if (bad.length) return refuse(new Map(bad.map((r) => [r.line, r.errors])), `Aynı modeldeki ${bad.map((r) => r.line).join(", ")}. satır hatalı; bir modelin satırları birlikte yüklenir.`);
    if (rows.length > MAX_VARIANTS_PER_MODEL) return all(`Bir model en fazla ${MAX_VARIANTS_PER_MODEL} varyant içerebilir.`);

    const axisAttrs = meta.attributes.filter((a) => a.isVariantAxis);
    const used = new Set(rows.flatMap((r) => Object.keys(r.values.variant ?? {})));
    const unknown = [...used].filter((c) => !axisAttrs.some((a) => a.code === c));
    if (unknown.length) return all(`“${unknown.join(", ")}” bir varyant özelliği değil.`);

    let input: ProductInput;
    let productName: string;
    // a new product's axes follow the sheet's column order (Renk, then Beden)
    let axes = [...used].map((c) => axisAttrs.find((a) => a.code === c)!);
    const existingCount = { n: 0 };
    if (existingId) {
      const editor = await this.catalog.editor(existingId);
      if (!editor) return all("Model koduna ait ürün bulunamadı (silinmiş olabilir).");
      if (!editor.axes.length) return all(`“${editor.name}” tek varyantlı bir ürün; yeni varyant eklemek için önce ürün düzenleyicide varyant özelliklerini (Renk, Beden …) seçin.`);
      const want = editor.axes.map((id) => axisAttrs.find((a) => a.id === id)).filter((a): a is (typeof axisAttrs)[number] => Boolean(a));
      if (want.length !== axes.length || want.some((a) => !used.has(a.code))) {
        return all(`${code} modeli ${want.map((a) => a.label).join(" + ")} ile çeşitleniyor; satırlarda tam olarak bu varyant sütunlarını doldurun.`);
      }
      axes = want;
      input = toSaveInput(editor);
      productName = editor.name;
      existingCount.n = input.variants.length;
    } else {
      if (!axes.length && rows.length > 1) return all("Aynı model kodlu satırlar tek ürünün varyantlarıdır: hangi seçenek olduklarını varyant sütunlarına (Renk, Beden …) yazın. Ayrı ürünlerse model kodunu boş bırakın.");
      const head = await this.newProduct(rows[0]!, meta, ctx);
      if ("error" in head) return all(head.error);
      input = head.input;
      productName = rows[0]!.values.name!;
    }

    // option of every axis for every row
    const rowErrors = new Map<number, string[]>();
    const labels = new Map<number, string>();
    const options = rows.map((r) => {
      const opts: Record<string, string> = {};
      const errs: string[] = [];
      for (const a of axes) {
        const text = r.values.variant?.[a.code];
        const opt = text ? findOption(a.options, text) : null;
        if (!text) errs.push(`${a.label} boş; bu modelin her satırı ${axes.map((x) => x.label).join(" + ")} değerini taşımalı.`);
        else if (!opt) errs.push(`${a.label} için “${text}” değeri tanımlı değil; Özellikler ekranından ekleyin.`);
        else if (opt.isActive === false) errs.push(`${a.label}: “${opt.label}” pasif; yeni varyantta kullanılamaz.`);
        else opts[a.id] = opt.id;
      }
      if (errs.length) rowErrors.set(r.line, errs);
      labels.set(r.line, axes.map((a) => a.options.find((o) => o.id === opts[a.id])?.label).filter(Boolean).join(" / ") || "Tek varyant");
      return opts;
    });
    if (rowErrors.size) return refuse(rowErrors, `Aynı modeldeki ${[...rowErrors.keys()].join(", ")}. satır hatalı; bir modelin satırları birlikte yüklenir.`);

    // photos: the same list on every row = the shared gallery, otherwise each row's photos belong to its variant (Renk)
    const lists = rows.map((r) => r.values.images ?? []);
    const shared = lists.every((l) => l.join("|") === lists[0]!.join("|"));
    const imported = new Map<string, string>();
    const importErrors: string[] = [];
    const photos = async (urls: string[]) => {
      if (!ctx.apply) return [];
      for (const u of urls.filter((x) => !imported.has(x))) {
        const got = await this.importImages([u], ctx.actor);
        imported.set(u, got.ids[0] ?? "");
        importErrors.push(...got.errors);
      }
      return urls.map((u) => imported.get(u)).filter((x): x is string => Boolean(x));
    };
    if (shared && lists[0]!.length) {
      const ids = await photos(lists[0]!);
      input.media = [...new Set([...input.media, ...ids])].slice(0, 30);
      input.primaryMediaId = input.primaryMediaId ?? input.media[0] ?? null;
    }
    const isNew = !existingId;
    for (const [i, r] of rows.entries()) {
      const v = r.values;
      input.variants.push({
        sku: v.sku!, barcode: v.barcode ?? null, name: null, options: options[i]!, priceMinor: v.priceMinor!,
        compareAtMinor: v.compareAtMinor != null && v.compareAtMinor > v.priceMinor! ? v.compareAtMinor : null, minPriceMinor: v.minPriceMinor ?? null,
        stock: v.stock ?? 0, isActive: true, isDefault: isNew && i === 0, media: shared ? [] : (await photos(lists[i]!)).slice(0, 20),
      });
    }
    input.axes = axes.map((a) => a.id);

    const parsed = this.catalog.parse(input);
    if (!parsed.ok) return all(parsed.errors.join(" "));
    const lineMessages = (r: NormalizedRow, i: number) => {
      const v = r.values;
      const msgs = [`${isNew ? (i === 0 ? `Yeni ürün: ${productName} · ${rows.length} varyant · ` : "") : `“${productName}” ürününe yeni varyant · `}${labels.get(r.line)} · ${tl(v.priceMinor)} · stok ${v.stock ?? 0}`];
      if (lists[i]!.length) msgs.push(shared ? (i === 0 ? `${lists[i]!.length} görsel ortak galeriye` : "") : `${lists[i]!.length} görsel bu varyanta`);
      return msgs.filter(Boolean);
    };
    const productId = existingId;
    if (!ctx.apply) {
      const errors = isNew ? await this.catalog.check(null, parsed.input, ctx.actor) : await this.catalog.check(existingId, parsed.input, ctx.actor);
      // photos are downloaded on "Yükle" only; the "a published product needs a photo" rule is checked then
      if (errors && lists.some((l) => l.length)) delete errors.media;
      if (errors && Object.keys(errors).length) {
        const split = messagesByVariant(errors);
        const own = new Map(rows.map((r, i) => [r.line, split.byIndex.get(existingCount.n + i) ?? []] as const));
        const others = [...split.byIndex.entries()].filter(([n]) => n < existingCount.n).flatMap(([, m]) => m);
        return rows.map((r) => ({ ...base(r), productId, productName, messages: [...split.all, ...others, ...own.get(r.line)!].length ? [...split.all, ...others, ...own.get(r.line)!] : ["Aynı modeldeki başka bir satır hatalı."] }));
      }
      return rows.map((r, i) => ({ ...base(r), status: "ok", productId, productName, messages: lineMessages(r, i) }));
    }
    const saved = isNew ? await this.catalog.create(parsed.input, ctx.actor) : await this.catalog.update(existingId!, parsed.input, ctx.actor);
    return rows.map((r, i) => ({ ...base(r), status: "created", productId: saved.id, productName, messages: [...lineMessages(r, i), ...(i === 0 ? importErrors : [])] }));
  }

  private async one(row: NormalizedRow, located: Map<string, LocatedProduct[]>, meta: ProductMeta, ctx: EngineContext): Promise<RowResult> {
    const base: RowResult = { line: row.line, key: row.key, status: "error", productId: null, productName: null, messages: [] };

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
      for (const [f, target] of [["accountingCode", "accountingCode"], ["manufacturerCode", "manufacturerCode"], ["modelCode", "modelCode"]] as const) {
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
      // a barcode / SKU of a product with variants names one variant (one colour): its own photos change, not the shared gallery
      const variantId = ctx.op === "images" && input.axes.length ? hits[0]!.variantId : null;
      const target = variantId ? input.variants.find((x) => x.id === variantId) : undefined;
      const label = target ? editor.variants.find((x) => x.id === target.id) : undefined;
      const where = target ? `${label?.sku ?? "varyant"} varyantının görsellerine` : "galeriye";
      changes.push(`${v.images.length} görsel ${ctx.imageMode === "append" ? `${where} eklenir` : `${where} yazılır (öncekilerin yerine)`}`);
      if (ctx.apply) {
        const imported = await this.importImages(v.images, ctx.actor);
        if (!imported.ids.length) return { ...result, messages: imported.errors };
        if (target) target.media = ctx.imageMode === "append" ? [...new Set([...target.media, ...imported.ids])].slice(0, 20) : imported.ids.slice(0, 20);
        else {
          input.media = ctx.imageMode === "append" ? [...new Set([...input.media, ...imported.ids])].slice(0, 30) : imported.ids;
          input.primaryMediaId = ctx.imageMode === "append" && input.primaryMediaId ? input.primaryMediaId : input.media[0] ?? null;
        }
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

  /** Product-level part of a new product from its (first) row: category, brand, status, texts; no variants yet. */
  private async newProduct(row: NormalizedRow, meta: ProductMeta, ctx: EngineContext): Promise<{ input: ProductInput } | { error: string }> {
    const v: RowValues = row.values;
    const isFeed = ctx.op === "feed";
    let categoryId = isFeed ? ctx.feed?.defaultCategoryId ?? null : null;
    if (v.category) {
      const c = resolveCategory(v.category, meta.categories);
      if (c.id) categoryId = c.id;
      else if (!isFeed || !categoryId) return { error: c.error! };
    }
    if (!categoryId) return { error: "Yeni ürün için kategori gerekli (kaynak ayarlarında varsayılan kategori seçin)." };
    let brandId: string | null = null;
    if (v.brand) {
      const b = resolveBrand(v.brand, meta.brands);
      if (b.id) brandId = b.id;
      else if (!isFeed) return { error: b.error! };
    }
    const keyField = ctx.matchKey === "accounting_code" ? "accountingCode" : ctx.matchKey === "manufacturer_code" ? "manufacturerCode" : null;
    return {
      input: {
        name: v.name!, status: isFeed ? ctx.feed!.newStatus : v.status ?? "draft", shortDescription: v.shortDescription ?? null, descriptionHtml: v.description ?? null,
        taxRateBps: v.taxRateBps ?? 2000, warrantyMonths: null, countryOfOrigin: null,
        accountingCode: v.accountingCode ?? (keyField === "accountingCode" ? row.key : null), manufacturerCode: v.manufacturerCode ?? (keyField === "manufacturerCode" ? row.key : null),
        modelCode: v.modelCode ?? null, brandId, categories: [{ id: categoryId, primary: true }], media: [], primaryMediaId: null, axes: [], variants: [],
        attributes: [], seo: { metaTitle: null, metaDescription: null, canonicalUrl: null, noindex: false },
      },
    };
  }

  private async create(row: NormalizedRow, meta: ProductMeta, ctx: EngineContext, base: RowResult): Promise<RowResult> {
    const v: RowValues = row.values;
    const missing = [!v.name && "ürün adı", v.priceMinor == null && "fiyat", !v.sku && !row.key && "SKU"].filter(Boolean);
    if (missing.length) return { ...base, messages: [`Yeni ürün için ${missing.join(", ")} gerekli.`] };
    const head = await this.newProduct(row, meta, ctx);
    if ("error" in head) return { ...base, messages: [head.error] };
    // feeds keyed by barcode / codes still need a SKU: the key itself (cleaned) when the feed has none
    const sku = (v.sku ?? row.key ?? "").toUpperCase().replace(/[^A-Z0-9._-]/g, "-").slice(0, 64);
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
      ...head.input, media, primaryMediaId: media[0] ?? null,
      variants: [{
        sku, barcode: v.barcode ?? (ctx.matchKey === "barcode" ? row.key : null), name: null, options: {}, priceMinor: v.priceMinor,
        compareAtMinor: v.compareAtMinor != null && v.compareAtMinor > v.priceMinor! ? v.compareAtMinor : null, minPriceMinor: v.minPriceMinor ?? null,
        stock: v.stock ?? 0, isActive: true, isDefault: true,
      }],
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
