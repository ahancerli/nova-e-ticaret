import { Repository, chunk, placeholders, type Statement } from "@/core";
import { DEFAULT_PRICE_LIST } from "@/modules/catalog/domain/product";
import {
  DEFAULT_SETTINGS, type ConnectionRow, type ConnectionStats, type MarketplaceProvider, type Mappings, type VariantSnapshot,
} from "../domain/marketplace";
import type { ConnectionWrite, ListingRow, MarketplaceOrderRow, MarketplaceRepository, SealedJson } from "../application/ports";

type ConnRaw = {
  id: string; provider: MarketplaceProvider; name: string; environment: "production" | "stage"; seller_id: string; settings_json: string; is_active: number;
  order_pull_minutes: number; stock_push_minutes: number; price_push_minutes: number; content_push_minutes: number;
  next_order_pull_at: string | null; next_stock_push_at: string | null; next_price_push_at: string | null; next_content_push_at: string | null;
  orders_synced_until: number | null; last_sync_at: string | null; last_error: string | null; created_by: string | null; created_at: string; updated_at: string;
};
const toConn = (r: ConnRaw): ConnectionRow => ({
  id: r.id, provider: r.provider, name: r.name, environment: r.environment, sellerId: r.seller_id,
  settings: { ...DEFAULT_SETTINGS, ...(JSON.parse(r.settings_json) as object) }, isActive: r.is_active === 1,
  intervals: { orders: r.order_pull_minutes, stock: r.stock_push_minutes, price: r.price_push_minutes, content: r.content_push_minutes },
  next: { orders: r.next_order_pull_at, stock: r.next_stock_push_at, price: r.next_price_push_at, content: r.next_content_push_at },
  ordersSyncedUntil: r.orders_synced_until, lastSyncAt: r.last_sync_at, lastError: r.last_error, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});
const NEXT_COL = { orders: "next_order_pull_at", stock: "next_stock_push_at", price: "next_price_push_at", content: "next_content_push_at" } as const;

export class D1MarketplaceRepository extends Repository implements MarketplaceRepository {
  async list() {
    const rows = (await this.db.all<ConnRaw>("SELECT * FROM marketplace_connections ORDER BY created_at")).map(toConn);
    return Promise.all(rows.map(async (c) => ({ ...c, stats: await this.stats(c.id) })));
  }

  async get(id: string) {
    const r = await this.db.first<ConnRaw>("SELECT * FROM marketplace_connections WHERE id = ?", id);
    return r ? toConn(r) : null;
  }

  async sealed(id: string) {
    const r = await this.db.first<{ credentials_sealed_json: string }>("SELECT credentials_sealed_json FROM marketplace_connections WHERE id = ?", id);
    return r ? (JSON.parse(r.credentials_sealed_json) as SealedJson) : null;
  }

  async stats(id: string): Promise<ConnectionStats> {
    const r = await this.db.first<Record<string, number>>(
      `SELECT (SELECT COUNT(*) FROM marketplace_listings WHERE connection_id = ?1) AS listings,
              (SELECT COUNT(*) FROM marketplace_listings WHERE connection_id = ?1 AND status = 'approved') AS approved,
              (SELECT COUNT(*) FROM marketplace_listings WHERE connection_id = ?1 AND status IN ('pending','submitted')) AS waiting,
              (SELECT COUNT(*) FROM marketplace_listings WHERE connection_id = ?1 AND status = 'rejected') AS rejected,
              (SELECT COUNT(*) FROM marketplace_listings WHERE connection_id = ?1 AND status = 'error') AS errors,
              (SELECT COUNT(*) FROM marketplace_pending WHERE connection_id = ?1 AND kind = 'content') AS q_content,
              (SELECT COUNT(*) FROM marketplace_pending WHERE connection_id = ?1 AND kind = 'stock') AS q_stock,
              (SELECT COUNT(*) FROM marketplace_pending WHERE connection_id = ?1 AND kind = 'price') AS q_price,
              (SELECT COUNT(*) FROM marketplace_orders WHERE connection_id = ?1 AND status = 'imported') AS o_imported,
              (SELECT COUNT(*) FROM marketplace_orders WHERE connection_id = ?1 AND status = 'failed') AS o_failed,
              (SELECT COUNT(*) FROM marketplace_batches WHERE connection_id = ?1 AND status = 'in_progress') AS batches`, id,
    );
    const n = (k: string) => r?.[k] ?? 0;
    return {
      listings: n("listings"), approved: n("approved"), waiting: n("waiting"), rejected: n("rejected"), errors: n("errors"),
      queued: { content: n("q_content"), stock: n("q_stock"), price: n("q_price") }, orders: { imported: n("o_imported"), failed: n("o_failed") }, openBatches: n("batches"),
    };
  }

  insertStatement(id: string, c: ConnectionWrite, sealed: SealedJson, actorId: string, now: string): Statement {
    return this.db.statement(
      `INSERT INTO marketplace_connections (id, provider, name, environment, seller_id, credentials_sealed_json, settings_json, is_active,
         order_pull_minutes, stock_push_minutes, price_push_minutes, content_push_minutes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, c.provider, c.name, c.environment, c.sellerId, JSON.stringify(sealed), JSON.stringify(c.settings), c.isActive ? 1 : 0,
      c.intervals.orders, c.intervals.stock, c.intervals.price, c.intervals.content, actorId, now, now,
    );
  }

  updateStatement(id: string, c: ConnectionWrite, sealed: SealedJson | null, expectedUpdatedAt: string, now: string): Statement {
    return this.db.statement(
      `UPDATE marketplace_connections SET name = ?, environment = ?, seller_id = ?, credentials_sealed_json = COALESCE(?, credentials_sealed_json),
              settings_json = ?, is_active = ?, order_pull_minutes = ?, stock_push_minutes = ?, price_push_minutes = ?, content_push_minutes = ?,
              -- new intervals apply from now on
              next_order_pull_at = NULL, next_stock_push_at = NULL, next_price_push_at = NULL, next_content_push_at = NULL, updated_at = ?
        WHERE id = ? AND updated_at = ?`,
      c.name, c.environment, c.sellerId, sealed ? JSON.stringify(sealed) : null, JSON.stringify(c.settings), c.isActive ? 1 : 0,
      c.intervals.orders, c.intervals.stock, c.intervals.price, c.intervals.content, now, id, expectedUpdatedAt,
    );
  }

  deleteStatement(id: string): Statement {
    return this.db.statement("DELETE FROM marketplace_connections WHERE id = ?", id);
  }

  async active() {
    return (await this.db.all<ConnRaw>("SELECT * FROM marketplace_connections WHERE is_active = 1 ORDER BY created_at")).map(toConn);
  }

  async setNext(id: string, task: "orders" | "stock" | "price" | "content", at: string) {
    await this.db.run(`UPDATE marketplace_connections SET ${NEXT_COL[task]} = ? WHERE id = ?`, at, id);
  }

  async setResult(id: string, r: { lastError: string | null; ordersSyncedUntil?: number | null }, now: string) {
    if (r.ordersSyncedUntil !== undefined) {
      await this.db.run("UPDATE marketplace_connections SET last_error = ?, last_sync_at = ?, orders_synced_until = COALESCE(?, orders_synced_until) WHERE id = ?", r.lastError?.slice(0, 1000) ?? null, now, r.ordersSyncedUntil, id);
    } else {
      await this.db.run("UPDATE marketplace_connections SET last_error = ?, last_sync_at = ? WHERE id = ?", r.lastError?.slice(0, 1000) ?? null, now, id);
    }
  }

  /** Internal cart marketplace orders hang on (orders → checkout_sessions → carts); created once per connection. */
  async ensureChannelCart(id: string): Promise<string> {
    const r = await this.db.first<{ channel_cart_id: string | null }>("SELECT channel_cart_id FROM marketplace_connections WHERE id = ?", id);
    if (r?.channel_cart_id) return r.channel_cart_id;
    const cartId = `cart_channel_${id}`;
    await this.db.batch([
      this.db.statement("INSERT OR IGNORE INTO carts (id, guest_token_hash, status) VALUES (?, ?, 'converted')", cartId, `channel:${id}`),
      this.db.statement("UPDATE marketplace_connections SET channel_cart_id = ? WHERE id = ? AND channel_cart_id IS NULL", cartId, id),
    ]);
    return cartId;
  }

  // --- mappings -------------------------------------------------------------------------------------
  async categoryMappings(id: string) {
    return (await this.db.all<{ category_id: string; external_category_id: number; external_category_path: string }>(
      "SELECT category_id, external_category_id, external_category_path FROM marketplace_category_mappings WHERE connection_id = ?", id,
    )).map((r) => ({ categoryId: r.category_id, externalCategoryId: r.external_category_id, path: r.external_category_path }));
  }

  async brandMappings(id: string) {
    return (await this.db.all<{ brand_id: string; external_brand_id: number; external_brand_name: string }>(
      "SELECT brand_id, external_brand_id, external_brand_name FROM marketplace_brand_mappings WHERE connection_id = ?", id,
    )).map((r) => ({ brandId: r.brand_id, externalBrandId: r.external_brand_id, name: r.external_brand_name }));
  }

  async attributeMappings(id: string) {
    return (await this.db.all<{ external_category_id: number; external_attribute_id: number; external_attribute_name: string; attribute_id: string | null; fixed_value_id: number | null; fixed_custom_value: string | null }>(
      "SELECT * FROM marketplace_attribute_mappings WHERE connection_id = ?", id,
    )).map((r) => ({ externalCategoryId: r.external_category_id, externalAttributeId: r.external_attribute_id, name: r.external_attribute_name, attributeId: r.attribute_id, fixedValueId: r.fixed_value_id, fixedCustomValue: r.fixed_custom_value }));
  }

  async valueMappings(id: string) {
    return (await this.db.all<{ external_attribute_id: number; option_id: string; external_value_id: number | null; custom_value: string | null }>(
      "SELECT external_attribute_id, option_id, external_value_id, custom_value FROM marketplace_value_mappings WHERE connection_id = ?", id,
    )).map((r) => ({ externalAttributeId: r.external_attribute_id, optionId: r.option_id, valueId: r.external_value_id, custom: r.custom_value }));
  }

  async setCategoryMapping(id: string, categoryId: string, ext: { id: number; path: string } | null) {
    if (!ext) await this.db.run("DELETE FROM marketplace_category_mappings WHERE connection_id = ? AND category_id = ?", id, categoryId);
    else await this.db.run(
      `INSERT INTO marketplace_category_mappings (connection_id, category_id, external_category_id, external_category_path) VALUES (?, ?, ?, ?)
       ON CONFLICT (connection_id, category_id) DO UPDATE SET external_category_id = excluded.external_category_id, external_category_path = excluded.external_category_path`,
      id, categoryId, ext.id, ext.path.slice(0, 500),
    );
  }

  async setBrandMapping(id: string, brandId: string, ext: { id: number; name: string } | null) {
    if (!ext) await this.db.run("DELETE FROM marketplace_brand_mappings WHERE connection_id = ? AND brand_id = ?", id, brandId);
    else await this.db.run(
      `INSERT INTO marketplace_brand_mappings (connection_id, brand_id, external_brand_id, external_brand_name) VALUES (?, ?, ?, ?)
       ON CONFLICT (connection_id, brand_id) DO UPDATE SET external_brand_id = excluded.external_brand_id, external_brand_name = excluded.external_brand_name`,
      id, brandId, ext.id, ext.name.slice(0, 200),
    );
  }

  async replaceAttributeMappings(id: string, externalCategoryId: number, rules: { externalAttributeId: number; name: string; attributeId: string | null; fixedValueId: number | null; fixedCustomValue: string | null }[], values: { externalAttributeId: number; optionId: string; valueId: number | null; custom: string | null }[]) {
    const st: Statement[] = [this.db.statement("DELETE FROM marketplace_attribute_mappings WHERE connection_id = ? AND external_category_id = ?", id, externalCategoryId)];
    for (const r of rules) {
      st.push(this.db.statement(
        "INSERT INTO marketplace_attribute_mappings (connection_id, external_category_id, external_attribute_id, external_attribute_name, attribute_id, fixed_value_id, fixed_custom_value) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id, externalCategoryId, r.externalAttributeId, r.name.slice(0, 200), r.attributeId, r.fixedValueId, r.fixedCustomValue,
      ));
    }
    for (const v of values) {
      st.push(this.db.statement(
        `INSERT INTO marketplace_value_mappings (connection_id, external_attribute_id, option_id, external_value_id, custom_value) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (connection_id, external_attribute_id, option_id) DO UPDATE SET external_value_id = excluded.external_value_id, custom_value = excluded.custom_value`,
        id, v.externalAttributeId, v.optionId, v.valueId, v.custom,
      ));
    }
    for (const part of chunk(st, 50)) await this.db.batch(part);
  }

  async mappings(id: string, provider: MarketplaceProvider): Promise<Mappings> {
    const [cats, brands, attrs, vals] = await Promise.all([this.categoryMappings(id), this.brandMappings(id), this.attributeMappings(id), this.valueMappings(id)]);
    const attributes = new Map<number, Mappings["attributes"] extends Map<number, infer V> ? V : never>();
    for (const a of attrs) attributes.set(a.externalCategoryId, [...(attributes.get(a.externalCategoryId) ?? []), a]);
    const required = new Map<number, { id: number; name: string; required: boolean; allowCustom: boolean }[]>();
    for (const extCat of new Set(cats.map((c) => c.externalCategoryId))) {
      const cached = await this.cachedAttributes(provider, extCat);
      if (cached) required.set(extCat, cached.payload);
    }
    return {
      category: new Map(cats.map((c) => [c.categoryId, c.externalCategoryId])),
      brand: new Map(brands.map((b) => [b.brandId, b.externalBrandId])),
      attributes, required,
      values: new Map(vals.map((v) => [`${v.externalAttributeId}:${v.optionId}`, { valueId: v.valueId, custom: v.custom }])),
    };
  }

  // --- reference caches -----------------------------------------------------------------------------
  async cachedCategories(provider: MarketplaceProvider, q: string, limit: number) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return (await this.db.all<{ external_id: number; path: string; is_leaf: number }>(
      "SELECT external_id, path, is_leaf FROM marketplace_category_cache WHERE provider = ? AND path LIKE ? ESCAPE '\\' ORDER BY is_leaf DESC, length(path) LIMIT ?", provider, like, limit,
    )).map((r) => ({ id: r.external_id, path: r.path, isLeaf: r.is_leaf === 1 }));
  }

  async categoryCacheAge(provider: MarketplaceProvider) {
    return (await this.db.first<{ t: string | null }>("SELECT MAX(fetched_at) AS t FROM marketplace_category_cache WHERE provider = ?", provider))?.t ?? null;
  }

  async replaceCategoryCache(provider: MarketplaceProvider, rows: { id: number; parentId: number | null; name: string; path: string; isLeaf: boolean }[], now: string) {
    await this.db.run("DELETE FROM marketplace_category_cache WHERE provider = ?", provider);
    for (const part of chunk(rows, 80)) {
      await this.db.batch(part.map((r) => this.db.statement(
        "INSERT OR REPLACE INTO marketplace_category_cache (provider, external_id, parent_id, name, path, is_leaf, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        provider, r.id, r.parentId, r.name, r.path, r.isLeaf ? 1 : 0, now,
      )));
    }
  }

  async cachedAttributes(provider: MarketplaceProvider, categoryId: number) {
    const r = await this.db.first<{ payload_json: string; fetched_at: string }>("SELECT payload_json, fetched_at FROM marketplace_attribute_cache WHERE provider = ? AND external_category_id = ?", provider, categoryId);
    return r ? { payload: JSON.parse(r.payload_json), fetchedAt: r.fetched_at } : null;
  }

  async cacheAttributes(provider: MarketplaceProvider, categoryId: number, payload: unknown, now: string) {
    await this.db.run(
      `INSERT INTO marketplace_attribute_cache (provider, external_category_id, payload_json, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (provider, external_category_id) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at`,
      provider, categoryId, JSON.stringify(payload), now,
    );
  }

  // --- listings + queue -----------------------------------------------------------------------------
  async listings(id: string, filter: { status?: string; q?: string }, limit: number): Promise<ListingRow[]> {
    const like = filter.q ? `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const rows = await this.db.all<{ variant_id: string; product_id: string; name: string; sku: string; barcode: string | null; label: string | null; status: string; content_id: number | null; last_error: string | null; last_pushed_at: string | null; image_url: string | null }>(
      `SELECT l.variant_id, l.product_id, p.name, v.sku, v.barcode, l.status, l.content_id, l.last_error, l.last_pushed_at,
              (SELECT group_concat(ao.label, ' / ') FROM variant_options vo JOIN attribute_options ao ON ao.id = vo.option_id WHERE vo.variant_id = v.id) AS label,
              (SELECT m.public_url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id WHERE pm.product_id = p.id ORDER BY pm.is_primary DESC, pm.sort_order LIMIT 1) AS image_url
         FROM marketplace_listings l JOIN product_variants v ON v.id = l.variant_id JOIN products p ON p.id = l.product_id
        WHERE l.connection_id = ? AND (? IS NULL OR l.status = ?) AND (? IS NULL OR p.name LIKE ? ESCAPE '\\' OR v.sku LIKE ? ESCAPE '\\' OR v.barcode LIKE ? ESCAPE '\\')
        ORDER BY CASE l.status WHEN 'error' THEN 0 WHEN 'rejected' THEN 1 WHEN 'pending' THEN 2 WHEN 'submitted' THEN 3 ELSE 4 END, p.name LIMIT ?`,
      id, filter.status ?? null, filter.status ?? null, like, like, like, like, limit,
    );
    return rows.map((r) => ({
      variantId: r.variant_id, productId: r.product_id, productName: r.name, sku: r.sku, barcode: r.barcode, variantLabel: r.label ?? "", status: r.status,
      contentId: r.content_id, lastError: r.last_error, lastPushedAt: r.last_pushed_at, imageUrl: r.image_url,
    }));
  }

  /** All active variants of the products become listings (existing ones stay as they are) and are queued for sending. */
  async addListings(id: string, productIds: string[]): Promise<number> {
    let added = 0;
    for (const part of chunk(productIds, 80)) {
      const r = await this.db.run(
        `INSERT OR IGNORE INTO marketplace_listings (connection_id, variant_id, product_id)
         SELECT ?, v.id, v.product_id FROM product_variants v WHERE v.is_active = 1 AND v.product_id IN (${placeholders(part.length)})`, id, ...part,
      );
      added += r.changes;
      await this.db.run(
        `INSERT OR IGNORE INTO marketplace_pending (connection_id, kind, variant_id)
         SELECT ?, 'content', l.variant_id FROM marketplace_listings l WHERE l.connection_id = ? AND l.product_id IN (${placeholders(part.length)}) AND l.status IN ('pending','error','rejected')`,
        id, id, ...part,
      );
    }
    return added;
  }

  async setListingsPaused(id: string, variantIds: string[], paused: boolean) {
    for (const part of chunk(variantIds, 80)) {
      await this.db.run(
        `UPDATE marketplace_listings SET status = CASE WHEN ? = 1 THEN 'paused' WHEN content_id IS NOT NULL THEN 'approved' ELSE 'pending' END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE connection_id = ? AND variant_id IN (${placeholders(part.length)})`, paused ? 1 : 0, id, ...part,
      );
      // paused on the marketplace = stock 0 there
      await this.db.run(
        `INSERT OR IGNORE INTO marketplace_pending (connection_id, kind, variant_id) SELECT ?, 'stock', variant_id FROM marketplace_listings
          WHERE connection_id = ? AND content_id IS NOT NULL AND variant_id IN (${placeholders(part.length)})`, id, id, ...part,
      );
    }
  }

  async enqueueFromChanges(c: { kind: "content" | "stock" | "price"; productIds: string[]; variantIds: string[] }): Promise<number> {
    let n = 0;
    const run = async (col: "product_id" | "variant_id", ids: string[]) => {
      for (const part of chunk([...new Set(ids)], 80)) {
        const r = await this.db.run(
          `INSERT OR IGNORE INTO marketplace_pending (connection_id, kind, variant_id)
           SELECT l.connection_id, ?, l.variant_id FROM marketplace_listings l JOIN marketplace_connections mc ON mc.id = l.connection_id AND mc.is_active = 1
            WHERE l.${col} IN (${placeholders(part.length)}) AND (l.status <> 'paused' OR ? = 'stock')`, c.kind, ...part, c.kind,
        );
        n += r.changes;
      }
    };
    if (c.productIds.length) await run("product_id", c.productIds);
    if (c.variantIds.length) await run("variant_id", c.variantIds);
    return n;
  }

  async enqueueAll(id: string, kinds: ("content" | "stock" | "price")[]) {
    for (const k of kinds) {
      await this.db.run(
        `INSERT OR IGNORE INTO marketplace_pending (connection_id, kind, variant_id) SELECT connection_id, ?, variant_id FROM marketplace_listings
          WHERE connection_id = ? AND (? = 'content' OR content_id IS NOT NULL)`, k, id, k,
      );
    }
  }

  async takePending(id: string, kind: "content" | "stock" | "price", limit: number) {
    return (await this.db.all<{ variant_id: string }>("SELECT variant_id FROM marketplace_pending WHERE connection_id = ? AND kind = ? ORDER BY queued_at LIMIT ?", id, kind, limit)).map((r) => r.variant_id);
  }

  async dropPending(id: string, kind: "content" | "stock" | "price", variantIds: string[]) {
    for (const part of chunk(variantIds, 80)) {
      await this.db.run(`DELETE FROM marketplace_pending WHERE connection_id = ? AND kind = ? AND variant_id IN (${placeholders(part.length)})`, id, kind, ...part);
    }
  }

  async snapshots(variantIds: string[], siteUrl: string): Promise<VariantSnapshot[]> {
    const out: VariantSnapshot[] = [];
    type R = {
      variant_id: string; product_id: string; sku: string; barcode: string | null; is_active: number; weight_grams: number | null; width_mm: number | null; height_mm: number | null; depth_mm: number | null;
      name: string; description_html: string | null; short_description: string | null; brand_id: string | null; status: string; tax_rate_bps: number; manufacturer_code: string | null; slug: string;
      category_id: string | null; unit_price_minor: number | null; compare_at_minor: number | null; available: number; images: string; var_opts: string | null; prod_vals: string | null;
    };
    for (const part of chunk(variantIds, 80)) {
      const rows = await this.db.all<R>(
        `SELECT v.id AS variant_id, v.product_id, v.sku, v.barcode, v.is_active, v.weight_grams, v.width_mm, v.height_mm, v.depth_mm,
                p.name, p.description_html, p.short_description, p.brand_id, p.status, p.tax_rate_bps, p.manufacturer_code, p.slug,
                (SELECT pc.category_id FROM product_categories pc WHERE pc.product_id = p.id ORDER BY pc.is_primary DESC LIMIT 1) AS category_id,
                vp.unit_price_minor, vp.compare_at_minor,
                COALESCE((SELECT SUM(ib.on_hand - ib.reserved) FROM inventory_balances ib WHERE ib.variant_id = v.id), 0) AS available,
                (SELECT json_group_array(x.url) FROM (SELECT m.public_url AS url FROM product_media pm JOIN media_assets m ON m.id = pm.media_id
                   WHERE pm.product_id = v.product_id AND (pm.variant_id = v.id OR pm.variant_id IS NULL)
                   ORDER BY pm.variant_id IS NULL, pm.is_primary DESC, pm.sort_order) AS x) AS images,
                (SELECT json_group_object(vo.attribute_id, vo.option_id) FROM variant_options vo WHERE vo.variant_id = v.id) AS var_opts,
                (SELECT json_group_array(json_object('a', pav.attribute_id, 'o', pav.option_id,
                        't', COALESCE(pav.text_value, CAST(pav.number_value AS TEXT), CASE pav.boolean_value WHEN 1 THEN 'Evet' WHEN 0 THEN 'Hayır' END)))
                   FROM product_attribute_values pav WHERE pav.product_id = v.product_id) AS prod_vals
           FROM product_variants v JOIN products p ON p.id = v.product_id
           LEFT JOIN variant_prices vp ON vp.variant_id = v.id AND vp.price_list_id = ?
          WHERE v.id IN (${placeholders(part.length)})`,
        DEFAULT_PRICE_LIST, ...part,
      );
      for (const r of rows) {
        const options: Record<string, string> = {};
        const texts: Record<string, string> = {};
        for (const pv of JSON.parse(r.prod_vals ?? "[]") as { a: string; o: string | null; t: string | null }[]) {
          if (pv.o) options[pv.a] ??= pv.o;
          else if (pv.t) texts[pv.a] = texts[pv.a] ? `${texts[pv.a]}, ${pv.t}` : pv.t;
        }
        Object.assign(options, JSON.parse(r.var_opts ?? "{}") as Record<string, string>);
        const abs = (u: string) => (u.startsWith("http") ? u : `${siteUrl}${u.startsWith("/") ? "" : "/"}${u}`);
        out.push({
          variantId: r.variant_id, productId: r.product_id, productMainId: (r.manufacturer_code || r.slug).slice(0, 40), title: r.name,
          description: r.description_html || r.short_description || r.name, brandId: r.brand_id, categoryId: r.category_id, sku: r.sku, barcode: r.barcode,
          sellable: r.is_active === 1 && r.status === "published", priceMinor: r.unit_price_minor, compareAtMinor: r.compare_at_minor, available: r.available,
          taxRateBps: r.tax_rate_bps, weightGrams: r.weight_grams,
          dimensionsMm: r.width_mm && r.height_mm && r.depth_mm ? [r.width_mm, r.height_mm, r.depth_mm] : null,
          images: [...new Set((JSON.parse(r.images) as string[]).filter(Boolean).map(abs))], options, texts,
        });
      }
    }
    return out;
  }

  async listingStates(id: string, variantIds: string[]) {
    const out = new Map<string, { status: string; contentId: number | null; contentHash: string | null; priceStockHash: string | null }>();
    for (const part of chunk(variantIds, 80)) {
      const rows = await this.db.all<{ variant_id: string; status: string; content_id: number | null; content_hash: string | null; price_stock_hash: string | null }>(
        `SELECT variant_id, status, content_id, content_hash, price_stock_hash FROM marketplace_listings WHERE connection_id = ? AND variant_id IN (${placeholders(part.length)})`, id, ...part,
      );
      for (const r of rows) out.set(r.variant_id, { status: r.status, contentId: r.content_id, contentHash: r.content_hash, priceStockHash: r.price_stock_hash });
    }
    return out;
  }

  async markListings(id: string, rows: { variantId: string; status?: string; contentId?: number | null; lastError?: string | null; contentHash?: string; priceStockHash?: string; batchId?: string }[], now: string) {
    for (const part of chunk(rows, 50)) {
      await this.db.batch(part.map((r) => this.db.statement(
        `UPDATE marketplace_listings SET
            status = COALESCE(?, status), content_id = CASE WHEN ? = 1 THEN ? ELSE content_id END,
            last_error = CASE WHEN ? = 1 THEN ? ELSE last_error END, content_hash = COALESCE(?, content_hash), price_stock_hash = COALESCE(?, price_stock_hash),
            last_batch_id = COALESCE(?, last_batch_id), last_pushed_at = CASE WHEN ? IS NOT NULL THEN ? ELSE last_pushed_at END, updated_at = ?
          WHERE connection_id = ? AND variant_id = ?`,
        r.status ?? null, r.contentId !== undefined ? 1 : 0, r.contentId ?? null, r.lastError !== undefined ? 1 : 0, r.lastError?.slice(0, 1000) ?? null,
        r.contentHash ?? null, r.priceStockHash ?? null, r.batchId ?? null, r.batchId ?? null, now, now, id, r.variantId,
      )));
    }
  }

  async submittedBarcodes(id: string, limit: number) {
    return (await this.db.all<{ variant_id: string; barcode: string }>(
      `SELECT l.variant_id, v.barcode FROM marketplace_listings l JOIN product_variants v ON v.id = l.variant_id
        WHERE l.connection_id = ? AND l.status = 'submitted' AND v.barcode IS NOT NULL ORDER BY l.updated_at LIMIT ?`, id, limit,
    )).map((r) => ({ variantId: r.variant_id, barcode: r.barcode }));
  }

  async insertBatch(b: { id: string; connectionId: string; kind: "content" | "stock" | "price"; variantIds: string[] }) {
    await this.db.run(
      "INSERT OR IGNORE INTO marketplace_batches (id, connection_id, kind, item_count, variant_ids_json) VALUES (?, ?, ?, ?, ?)",
      b.id, b.connectionId, b.kind, b.variantIds.length, JSON.stringify(b.variantIds),
    );
  }

  async openBatches(id: string, limit: number) {
    return (await this.db.all<{ id: string; kind: string; variant_ids_json: string }>(
      "SELECT id, kind, variant_ids_json FROM marketplace_batches WHERE connection_id = ? AND status = 'in_progress' ORDER BY created_at LIMIT ?", id, limit,
    )).map((r) => ({ id: r.id, kind: r.kind, variantIds: JSON.parse(r.variant_ids_json) as string[] }));
  }

  async closeBatch(batchId: string, status: "completed" | "failed", failed: number, now: string) {
    await this.db.run("UPDATE marketplace_batches SET status = ?, failed_count = ?, checked_at = ? WHERE id = ?", status, failed, now, batchId);
  }

  // --- orders ---------------------------------------------------------------------------------------
  async orderLog(id: string, status: string | null, limit: number): Promise<MarketplaceOrderRow[]> {
    const rows = await this.db.all<{ external_package_id: string; external_order_number: string; status: MarketplaceOrderRow["status"]; external_status: string | null; error: string | null; order_id: string | null; order_number: string | null; total_minor: number | null; attempts: number; updated_at: string }>(
      `SELECT mo.*, o.order_number, o.total_minor FROM marketplace_orders mo LEFT JOIN orders o ON o.id = mo.order_id
        WHERE mo.connection_id = ? AND (? IS NULL OR mo.status = ?) ORDER BY mo.updated_at DESC LIMIT ?`, id, status, status, limit,
    );
    return rows.map((r) => ({
      packageId: r.external_package_id, orderNumber: r.external_order_number, status: r.status, externalStatus: r.external_status, error: r.error,
      orderId: r.order_id, ourOrderNumber: r.order_number, totalMinor: r.total_minor, attempts: r.attempts, updatedAt: r.updated_at,
    }));
  }
}
