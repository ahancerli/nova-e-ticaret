import { MarketplaceErrors } from "../domain/errors";
import { parseTrendyolPackage, type MarketplacePackage, type TrendyolItem } from "../domain/marketplace";
import type { Credentials, MarketplaceClient } from "../application/ports";

const BASE = { production: "https://apigw.trendyol.com/integration", stage: "https://stageapigw.trendyol.com/integration" } as const;

/**
 * Trendyol Seller API (developers.trendyol.com, Product V2). Basic auth with API key / secret, the mandatory
 * User-Agent "{sellerId} - SelfIntegration", storeFrontCode TR. Writes are asynchronous: they return a batchRequestId
 * that `batchResult` reads back. 1,000 items per write request.
 */
export class TrendyolClient implements MarketplaceClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly cfg: { environment: "production" | "stage"; sellerId: string }, creds: Credentials, private readonly doFetch: typeof fetch = (...a) => fetch(...a)) {
    this.base = BASE[cfg.environment];
    this.headers = {
      authorization: `Basic ${btoa(`${creds.apiKey}:${creds.apiSecret}`)}`,
      "user-agent": `${cfg.sellerId} - SelfIntegration`,
      storefrontcode: "TR",
      "accept-language": "tr",
      accept: "application/json",
    };
  }

  private seller(path: string) {
    return `/product/sellers/${encodeURIComponent(this.cfg.sellerId)}${path}`;
  }

  private async req<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, allow404 = false): Promise<T | null> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method, headers: body === undefined ? this.headers : { ...this.headers, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw MarketplaceErrors.unreachable();
    }
    if (res.status === 401 || res.status === 403) throw MarketplaceErrors.auth();
    if (res.status === 404 && allow404) return null;
    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 300);
      try {
        const j = JSON.parse(text) as { errors?: { message?: string }[]; message?: string };
        message = j.errors?.map((e) => e.message).filter(Boolean).join("; ") || j.message || message;
      } catch { /* not JSON */ }
      throw MarketplaceErrors.api(res.status, message);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  private batchId(r: { batchRequestId?: string } | null): string {
    if (!r?.batchRequestId) throw MarketplaceErrors.api(200, "batchRequestId dönmedi");
    return r.batchRequestId;
  }

  async test(): Promise<void> {
    await this.req("GET", `${this.seller("/products")}?page=0&size=1`);
  }

  async categoryTree() {
    type Node = { id: number; name: string; parentId?: number | null; subCategories?: Node[] };
    const tree = (await this.req<Node[] | { categories: Node[] }>("GET", "/product/product-categories")) ?? [];
    const roots = Array.isArray(tree) ? tree : tree.categories ?? [];
    const out: { id: number; parentId: number | null; name: string; path: string; isLeaf: boolean }[] = [];
    const walk = (n: Node, parent: string, parentId: number | null) => {
      const path = parent ? `${parent} > ${n.name}` : n.name;
      const kids = n.subCategories ?? [];
      out.push({ id: n.id, parentId, name: n.name, path, isLeaf: !kids.length });
      for (const k of kids) walk(k, path, n.id);
    };
    for (const r of roots) walk(r, "", null);
    return out;
  }

  async categoryAttributes(categoryId: number) {
    type A = { attribute: { id: number; name: string }; required?: boolean; allowCustom?: boolean; varianter?: boolean };
    const r = await this.req<{ categoryAttributes?: A[] }>("GET", `/product/categories/${categoryId}/attributes`);
    return (r?.categoryAttributes ?? []).map((a) => ({ id: a.attribute.id, name: a.attribute.name, required: !!a.required, allowCustom: !!a.allowCustom, varianter: !!a.varianter }));
  }

  async attributeValues(categoryId: number, attributeId: number) {
    const out: { id: number; name: string }[] = [];
    for (let page = 0; page < 5; page++) {
      const r = await this.req<{ content?: { attributeValueId: number; attributeValueName: string }[]; totalPages?: number }>(
        "GET", `/product/categories/${categoryId}/attributes/${attributeId}/values?page=${page}&size=1000`, undefined, true);
      out.push(...(r?.content ?? []).map((v) => ({ id: v.attributeValueId, name: v.attributeValueName })));
      if (!r || page + 1 >= (r.totalPages ?? 1)) break;
    }
    return out;
  }

  async brands(name: string) {
    const fold = (s: string) => s.toLocaleLowerCase("tr-TR");
    // by-name lookup where available; otherwise the first pages of the brand list, filtered here
    const byName = await this.req<{ id: number; name: string }[]>("GET", `/product/brands/by-name?name=${encodeURIComponent(name)}`, undefined, true).catch(() => null);
    if (byName?.length) return byName.slice(0, 50);
    const out: { id: number; name: string }[] = [];
    for (let page = 0; page < 3 && out.length < 50; page++) {
      const r = await this.req<{ brands?: { id: number; name: string }[] }>("GET", `/product/brands?page=${page}&size=1000`);
      out.push(...(r?.brands ?? []).filter((b) => fold(b.name).includes(fold(name))));
      if (!r?.brands?.length) break;
    }
    return out.slice(0, 50);
  }

  async createProducts(items: TrendyolItem[]) {
    return this.batchId(await this.req("POST", this.seller("/products"), { items }));
  }

  async updateUnapproved(items: TrendyolItem[]) {
    return this.batchId(await this.req("POST", this.seller("/products/unapproved-bulk-update"), { items }));
  }

  async updateApprovedContent(items: { contentId: number; item: TrendyolItem }[]) {
    return this.batchId(await this.req("POST", this.seller("/products/content-bulk-update"), {
      items: items.map(({ contentId, item }) => ({
        contentId, title: item.title, description: item.description, images: item.images,
        attributes: item.attributes.map((a) => ("attributeValueId" in a ? { attributeId: a.attributeId, attributeValueIds: [a.attributeValueId] } : { attributeId: a.attributeId, attributeValue: a.customAttributeValue })),
      })),
    }));
  }

  async updatePriceStock(items: { barcode: string; quantity?: number; salePrice?: number; listPrice?: number }[]) {
    return this.batchId(await this.req("POST", `/inventory/sellers/${encodeURIComponent(this.cfg.sellerId)}/products/price-and-inventory`, { items }));
  }

  async batchResult(batchId: string) {
    type R = { status?: string; items?: { status?: string; failureReasons?: unknown[]; requestItem?: { barcode?: string; product?: { barcode?: string } } }[] };
    const r = await this.req<R>("GET", this.seller(`/products/batch-requests/${encodeURIComponent(batchId)}`), undefined, true);
    if (!r) return { done: true, items: [] };
    return {
      done: r.status === "COMPLETED",
      items: (r.items ?? []).map((i) => ({
        barcode: i.requestItem?.barcode ?? i.requestItem?.product?.barcode ?? null,
        ok: i.status === "SUCCESS",
        reasons: (i.failureReasons ?? []).map((f) => (typeof f === "string" ? f : JSON.stringify(f))).slice(0, 5),
      })),
    };
  }

  async productStatus(barcode: string) {
    type P = { barcode?: string; approved?: boolean; rejected?: boolean; contentId?: number; productContentId?: number; rejectReasonDetails?: { rejectReason?: string; rejectReasonDetail?: string }[] };
    const r = await this.req<{ content?: P[] }>("GET", `${this.seller("/products")}?barcode=${encodeURIComponent(barcode)}&page=0&size=1`);
    const p = r?.content?.find((x) => x.barcode === barcode) ?? r?.content?.[0];
    if (!p) return null;
    return {
      approved: !!p.approved, rejected: !!p.rejected, contentId: p.contentId ?? p.productContentId ?? null,
      reasons: (p.rejectReasonDetails ?? []).map((d) => [d.rejectReason, d.rejectReasonDetail].filter(Boolean).join(": ")).slice(0, 5),
    };
  }

  async orders(q: { startMs: number; endMs: number; page: number; size: number }): Promise<{ packages: MarketplacePackage[]; totalPages: number }> {
    const qs = new URLSearchParams({
      startDate: String(q.startMs), endDate: String(q.endMs), page: String(q.page), size: String(Math.min(200, q.size)),
      orderByField: "PackageLastModifiedDate", orderByDirection: "ASC",
    });
    const r = await this.req<{ content?: Record<string, unknown>[]; totalPages?: number }>("GET", `/order/sellers/${encodeURIComponent(this.cfg.sellerId)}/orders?${qs}`);
    return { packages: (r?.content ?? []).map(parseTrendyolPackage).filter((p) => p.packageId && p.orderNumber), totalPages: r?.totalPages ?? 1 };
  }
}
