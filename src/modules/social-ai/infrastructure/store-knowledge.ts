import { Repository, type Clock } from "@/core";
import { ORDER_STATUS, PAYMENT_STATUS, SHIPMENT_STATUS } from "@/lib/order-rules";
import type { ProductCard, ProductDetail } from "@/lib/types";
import { deliveryPromise, formatCutoff, type DeliveryRules } from "@/modules/delivery/domain/delivery";
import type { ContentHit, OrderStatusInfo, ProductBrief, ProductInfo, ShippingInfo, StoreKnowledge, StoreProfile } from "../application/ports";
import { samePhone } from "../domain/social-ai";

/** The other modules' queries this adapter reads through (their use cases, resolved in module.ts). */
export interface KnowledgeSources {
  listProducts: { execute(p: { q?: string; inStock?: boolean; maxPrice?: number; sort: "relevance"; page: number; attrs: Record<string, string[]> }): Promise<{ items: ProductCard[] }> };
  productDetail: { execute(slug: string): Promise<ProductDetail | null> };
  productCards: { execute(ids: string[]): Promise<ProductCard[]> };
  pages: { execute(): Promise<{ slug: string; title: string; status: string }[]> };
  publishedPage: { execute(slug: string): Promise<{ slug: string; title: string; html: string } | null> };
  questions: { execute(productId: string): Promise<{ items: { body: string; answer: string }[] }> };
  sizeChart: { execute(productId: string): Promise<{ name: string; columns: string[]; rows: string[][]; note: string | null } | null> };
  deliveryRules: { execute(): Promise<DeliveryRules | null> };
  settings: { execute(): Promise<{ siteName: string; company: { address: string | null }; contact: { email: string | null; phone: string | null; hours: string | null } }> };
}

/** Facts no other module exposes as a query yet: shipping fees and the order status lookup by number + proof. */
export class D1StoreFacts extends Repository {
  shippingMethods(): Promise<{ name: string; fee_minor: number; free_above_minor: number | null }[]> {
    return this.db.all("SELECT name, fee_minor, free_above_minor FROM shipping_methods WHERE is_active = 1 ORDER BY fee_minor, name");
  }

  async order(orderNumber: string) {
    const o = await this.db.first<{ id: string; order_number: string; placed_at: string; status: string; payment_status: string; total_minor: number; customer_email: string; customer_phone: string | null; address_phone: string | null }>(
      `SELECT o.id, o.order_number, o.placed_at, o.status, o.payment_status, o.total_minor, o.customer_email, o.customer_phone,
              (SELECT a.phone_e164 FROM order_addresses a WHERE a.order_id = o.id LIMIT 1) AS address_phone
         FROM orders o WHERE o.order_number = ? AND o.sales_channel = 'web'`, orderNumber,
    );
    if (!o) return null;
    const [items, shipments] = await Promise.all([
      this.db.all<{ name: string; quantity: number }>("SELECT product_name_snapshot AS name, quantity FROM order_items WHERE order_id = ? ORDER BY rowid", o.id),
      this.db.all<{ status: string; tracking_number: string | null; tracking_url: string | null; shipped_at: string | null; delivered_at: string | null }>(
        "SELECT status, tracking_number, tracking_url, shipped_at, delivered_at FROM shipments WHERE order_id = ? AND status <> 'cancelled' ORDER BY created_at", o.id),
    ]);
    return { ...o, items, shipments };
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Rich HTML → plain text with paragraph breaks (the model reads text, not markup). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    })
    .replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
}

const fold = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");
const STOP = new Set(["ve", "ile", "bir", "bu", "mi", "mu", "ne", "nasil", "icin", "var", "yok", "kac", "the", "de", "da", "ben", "siz", "hangi"]);
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
const CHUNK = 700;

/** Paragraphs packed into chunks of about `CHUNK` characters. */
export function chunkText(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur && cur.length + line.length > CHUNK) { out.push(cur); cur = ""; }
    cur = cur ? `${cur}\n${line}` : line;
    while (cur.length > CHUNK * 2) { out.push(cur.slice(0, CHUNK * 2)); cur = cur.slice(CHUNK * 2); }
  }
  if (cur) out.push(cur);
  return out;
}

/** Word-overlap score; a word that only matches as a prefix (Turkish suffixes: "iade" ~ "iadesi") counts half. */
export function scoreChunk(queryWords: string[], title: string, chunk: string): number {
  const body = words(chunk), head = new Set(words(title));
  let score = 0;
  for (const q of queryWords) {
    if (head.has(q)) score += 2;
    if (body.includes(q)) score += 2;
    else if (q.length >= 4 && body.some((w) => w.startsWith(q) || q.startsWith(w) && w.length >= 4)) score += 1;
  }
  return score;
}

const briefOf = (c: ProductCard, siteUrl: string): ProductBrief => ({
  id: c.id, name: c.name, brand: c.brandName, priceMinor: c.priceMinor, cartPriceMinor: c.campaignPriceMinor != null && c.priceMinor != null && c.campaignPriceMinor < c.priceMinor ? c.campaignPriceMinor : null,
  compareAtMinor: c.compareAtMinor, inStock: c.inStock, campaigns: c.promotions.map((p) => p.label), url: `${siteUrl}/urun/${c.slug}`,
});

/** StoreKnowledge on the storefront / content / delivery / settings queries: the bot reads exactly what the shop shows. */
export class ModuleStoreKnowledge implements StoreKnowledge {
  constructor(private readonly src: KnowledgeSources, private readonly facts: D1StoreFacts, private readonly siteUrl: string, private readonly clock: Clock) {}

  async store(): Promise<StoreProfile> {
    const s = await this.src.settings.execute();
    return { name: s.siteName, siteUrl: this.siteUrl, email: s.contact.email, phone: s.contact.phone, hours: s.contact.hours, address: s.company.address };
  }

  async searchProducts(query: string, opts: { inStockOnly?: boolean; maxPriceMinor?: number | null; limit?: number }): Promise<ProductBrief[]> {
    const page = await this.src.listProducts.execute({
      q: query.slice(0, 120), sort: "relevance", page: 1, attrs: {},
      ...(opts.inStockOnly ? { inStock: true } : {}), ...(opts.maxPriceMinor ? { maxPrice: opts.maxPriceMinor } : {}),
    });
    return page.items.slice(0, opts.limit ?? 6).map((c) => briefOf(c, this.siteUrl));
  }

  async productsByIds(ids: string[]): Promise<ProductBrief[]> {
    const clean = [...new Set(ids.filter((id) => id && id.length <= 80))].slice(0, 12);
    return clean.length ? (await this.src.productCards.execute(clean)).map((c) => briefOf(c, this.siteUrl)) : [];
  }

  async product(id: string): Promise<ProductInfo | null> {
    if (!id || id.length > 80) return null;
    const [card] = await this.src.productCards.execute([id]);
    const p = card ? await this.src.productDetail.execute(card.slug) : null;
    if (!card || !p) return null;
    const [chart, questions] = await Promise.all([this.src.sizeChart.execute(p.id), this.src.questions.execute(p.id)]);
    const axisLabel = new Map(p.axes.map((a) => [a.code, a]));
    return {
      ...briefOf(card, this.siteUrl),
      campaigns: p.promotions.map((b) => b.label),
      shortDescription: p.shortDescription,
      description: p.descriptionHtml ? htmlToText(p.descriptionHtml).slice(0, 2500) : null,
      variants: p.variants.slice(0, 60).map((v) => ({
        options: Object.entries(v.options).map(([code, value]) => {
          const axis = axisLabel.get(code);
          return `${axis?.label ?? code}: ${axis?.options.find((o) => o.value === value)?.label ?? value}`;
        }).join(", ") || "Tek seçenek",
        priceMinor: v.priceMinor,
        cartPriceMinor: v.campaignPriceMinor != null && v.priceMinor != null && v.campaignPriceMinor < v.priceMinor ? v.campaignPriceMinor : null,
        inStock: v.available > 0, fewLeft: v.available > 0 && v.available <= 3,
      })),
      specs: p.specs.slice(0, 30),
      sizeChart: chart,
      questions: questions.items.slice(0, 8).map((q) => ({ question: q.body, answer: q.answer })),
      rating: p.rating, ratingCount: p.ratingCount,
    };
  }

  async searchContent(query: string): Promise<ContentHit[]> {
    const q = words(query);
    if (!q.length) return [];
    const published = (await this.src.pages.execute()).filter((p) => p.status === "published").slice(0, 60);
    const docs: { title: string; url: string | null; text: string }[] = [];
    for (const row of published) {
      const page = await this.src.publishedPage.execute(row.slug);
      if (page) docs.push({ title: page.title, url: `${this.siteUrl}/sayfa/${page.slug}`, text: htmlToText(page.html) });
    }
    const store = await this.store();
    docs.push({
      title: "İletişim ve mağaza bilgileri", url: null,
      text: [`Mağaza: ${store.name}`, store.email && `E-posta: ${store.email}`, store.phone && `Telefon: ${store.phone}`, store.hours && `Çalışma saatleri: ${store.hours}`, store.address && `Adres: ${store.address}`].filter(Boolean).join("\n"),
    });
    return docs
      .flatMap((d) => chunkText(d.text).map((c) => ({ title: d.title, url: d.url, excerpt: c, score: scoreChunk(q, d.title, c) })))
      .filter((h) => h.score >= 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(({ title, url, excerpt }) => ({ title, url, excerpt }));
  }

  async shipping(): Promise<ShippingInfo> {
    const [methods, rules] = await Promise.all([this.facts.shippingMethods(), this.src.deliveryRules.execute()]);
    const promise = rules ? deliveryPromise(rules, this.clock.now()) : null;
    return {
      methods: methods.map((m) => ({ name: m.name, feeMinor: m.fee_minor, freeAboveMinor: m.free_above_minor })),
      estimate: promise && rules
        ? `${promise.orderWithinMinutes != null ? `Bugün ${formatCutoff(rules.cutoffMinutes)}'e kadar verilen sipariş` : "Şimdi verilen sipariş"} ${promise.shipLabel} kargoya verilir; tahmini teslim ${promise.deliveryLabel}.`
        : null,
    };
  }

  async orderStatus(orderNumber: string, proof: { email?: string | null; phones: string[] }): Promise<OrderStatusInfo | null> {
    const no = orderNumber.trim().toUpperCase();
    if (!/^[A-Z0-9-]{4,40}$/.test(no)) return null;
    const o = await this.facts.order(no);
    if (!o) return null;
    const emailOk = !!proof.email && proof.email.trim().toLowerCase() === o.customer_email.toLowerCase();
    const phoneOk = proof.phones.some((p) => samePhone(p, o.customer_phone) || samePhone(p, o.address_phone));
    if (!emailOk && !phoneOk) return null;
    return {
      orderNumber: o.order_number, placedAt: o.placed_at,
      statusLabel: ORDER_STATUS[o.status as keyof typeof ORDER_STATUS]?.label ?? o.status,
      paymentLabel: PAYMENT_STATUS[o.payment_status as keyof typeof PAYMENT_STATUS]?.label ?? o.payment_status,
      totalMinor: o.total_minor, items: o.items,
      shipments: o.shipments.map((s) => ({ statusLabel: SHIPMENT_STATUS[s.status]?.label ?? s.status, trackingNumber: s.tracking_number, trackingUrl: s.tracking_url, shippedAt: s.shipped_at, deliveredAt: s.delivered_at })),
    };
  }
}
