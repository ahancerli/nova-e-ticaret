/**
 * Marketplaces (Pazaryerleri) — pure types and rules. One connection = one seller account on one marketplace.
 * Trendyol is implemented; Hepsiburada, N11 and Çiçeksepeti plug in with their own client behind the same port
 * (application/ports.ts → MarketplaceClient) and reuse mappings, listings, sync and order import unchanged.
 */

export const MARKETPLACES = {
  trendyol: { label: "Trendyol", ready: true, color: "#F27A1A", hint: "Ürün, stok, fiyat ve sipariş senkronu (Trendyol Seller API, Product V2)." },
  hepsiburada: { label: "Hepsiburada", ready: false, color: "#FF6000", hint: "Yakında: aynı eşleştirme ve senkron altyapısıyla." },
  n11: { label: "N11", ready: false, color: "#5C2D91", hint: "Yakında." },
  ciceksepeti: { label: "Çiçeksepeti", ready: false, color: "#0E7C3A", hint: "Yakında." },
} as const;
export type MarketplaceProvider = keyof typeof MARKETPLACES;
export const MARKETPLACE_KEYS = Object.keys(MARKETPLACES) as MarketplaceProvider[];

export const SYNC_INTERVALS = {
  orders: [1, 5, 10, 15, 30, 60],
  stock: [1, 5, 10, 15, 30, 60],
  price: [1, 5, 10, 15, 30, 60],
  content: [5, 15, 30, 60, 180, 360, 720, 1440],
} as const;

export interface ConnectionSettings {
  /** Trendyol cargo company id (required on every product). */
  cargoCompanyId: number | null;
  /** 0 = same-day shipping, 1 = next day at the latest. */
  deliveryDuration: number;
  shipmentAddressId: number | null;
  returningAddressId: number | null;
  /** Marketplace price = shop price ± this percent (commission cover). */
  priceAdjustPct: number;
  /** Units kept back from the marketplace (safety stock). */
  stockBuffer: number;
  /** Send the shop's struck-through price as listPrice (else listPrice = salePrice). */
  useCompareAtAsListPrice: boolean;
}

export const DEFAULT_SETTINGS: ConnectionSettings = {
  cargoCompanyId: null, deliveryDuration: 1, shipmentAddressId: null, returningAddressId: null, priceAdjustPct: 0, stockBuffer: 0, useCompareAtAsListPrice: true,
};

export interface ConnectionIntervals {
  orders: number;
  stock: number;
  price: number;
  content: number;
}

export interface ConnectionRow {
  id: string;
  provider: MarketplaceProvider;
  name: string;
  environment: "production" | "stage";
  sellerId: string;
  settings: ConnectionSettings;
  isActive: boolean;
  intervals: ConnectionIntervals;
  next: { orders: string | null; stock: string | null; price: string | null; content: string | null };
  ordersSyncedUntil: number | null;
  lastSyncAt: string | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionStats {
  listings: number;
  approved: number;
  waiting: number;
  rejected: number;
  errors: number;
  queued: { content: number; stock: number; price: number };
  orders: { imported: number; failed: number };
  openBatches: number;
}

export const LISTING_STATUS: Record<string, { label: string; tone: "slate" | "blue" | "green" | "red" | "amber" }> = {
  pending: { label: "Gönderilecek", tone: "slate" },
  submitted: { label: "Onay bekliyor", tone: "blue" },
  approved: { label: "Satışta", tone: "green" },
  rejected: { label: "Reddedildi", tone: "red" },
  error: { label: "Hata", tone: "red" },
  paused: { label: "Durduruldu", tone: "amber" },
};

// --- product → marketplace item ------------------------------------------------------------------------

/** Everything a variant needs on a marketplace (read fresh from the catalog when pushing). */
export interface VariantSnapshot {
  variantId: string;
  productId: string;
  productMainId: string;
  title: string;
  description: string;
  brandId: string | null;
  categoryId: string | null;
  sku: string;
  barcode: string | null;
  sellable: boolean;
  priceMinor: number | null;
  compareAtMinor: number | null;
  available: number;
  taxRateBps: number;
  weightGrams: number | null;
  dimensionsMm: [number, number, number] | null;
  /** Absolute https URLs, the variant's own images first. */
  images: string[];
  /** Variant axis values and select-type product values: attribute id → option id. */
  options: Record<string, string>;
  /** Text / number / boolean product values: attribute id → text. */
  texts: Record<string, string>;
}

export interface Mappings {
  category: Map<string, number>;
  brand: Map<string, number>;
  /** external category id → attribute rules. */
  attributes: Map<number, { externalAttributeId: number; name: string; attributeId: string | null; fixedValueId: number | null; fixedCustomValue: string | null }[]>;
  /** `${externalAttributeId}:${optionId}` → value. */
  values: Map<string, { valueId: number | null; custom: string | null }>;
  /** external category id → its attributes as the marketplace defines them (required / custom allowed). */
  required: Map<number, { id: number; name: string; required: boolean; allowCustom: boolean }[]>;
}

export interface TrendyolItem {
  barcode: string;
  title: string;
  productMainId: string;
  brandId: number;
  categoryId: number;
  quantity: number;
  stockCode: string;
  dimensionalWeight: number;
  description: string;
  currencyType: "TRY";
  listPrice: number;
  salePrice: number;
  vatRate: number;
  cargoCompanyId: number;
  deliveryOption: { deliveryDuration: number };
  shipmentAddressId?: number;
  returningAddressId?: number;
  images: { url: string }[];
  attributes: ({ attributeId: number; attributeValueId: number } | { attributeId: number; customAttributeValue: string })[];
}

const money = (minor: number) => Math.round(minor) / 100;
const adjust = (minor: number, pct: number) => Math.max(0, Math.round(minor * (1 + pct / 100)));

/** Desi = max(kg, cm³ / 3000), at least 1 (Trendyol dimensionalWeight). */
export function desi(weightGrams: number | null, dims: [number, number, number] | null): number {
  const kg = (weightGrams ?? 0) / 1000;
  const volumetric = dims ? (dims[0] / 10) * (dims[1] / 10) * (dims[2] / 10) / 3000 : 0;
  return Math.max(1, Math.round(Math.max(kg, volumetric) * 100) / 100);
}

/** Sellable quantity on the marketplace: stock minus the safety buffer, 0 when not sellable, Trendyol max 20,000. */
export const marketQuantity = (v: Pick<VariantSnapshot, "available" | "sellable">, s: Pick<ConnectionSettings, "stockBuffer">) =>
  v.sellable ? Math.max(0, Math.min(20_000, v.available - s.stockBuffer)) : 0;

/** Sale / list price in TL after the connection's adjustment. */
export function marketPrices(v: Pick<VariantSnapshot, "priceMinor" | "compareAtMinor">, s: Pick<ConnectionSettings, "priceAdjustPct" | "useCompareAtAsListPrice">): { salePrice: number; listPrice: number } | null {
  if (v.priceMinor == null || v.priceMinor <= 0) return null;
  const sale = adjust(v.priceMinor, s.priceAdjustPct);
  const list = s.useCompareAtAsListPrice && v.compareAtMinor != null && v.compareAtMinor > v.priceMinor ? adjust(v.compareAtMinor, s.priceAdjustPct) : sale;
  return { salePrice: money(sale), listPrice: money(Math.max(list, sale)) };
}

/** Variant → Trendyol Product V2 item, or the reasons it cannot be sent yet (in Turkish, for the panel). */
export function buildTrendyolItem(v: VariantSnapshot, m: Mappings, s: ConnectionSettings): { item: TrendyolItem } | { problems: string[] } {
  const problems: string[] = [];
  if (!v.barcode) problems.push("Varyantın barkodu yok (Özellikler › Barkod üret).");
  else if (v.barcode.length > 40 || !/^[A-Za-z0-9._-]+$/.test(v.barcode)) problems.push("Barkod en fazla 40 karakter; harf, rakam, nokta, tire, alt çizgi.");
  const brandId = v.brandId ? m.brand.get(v.brandId) : undefined;
  if (!v.brandId) problems.push("Ürünün markası yok.");
  else if (!brandId) problems.push("Marka Trendyol markasıyla eşleştirilmedi.");
  const categoryId = v.categoryId ? m.category.get(v.categoryId) : undefined;
  if (!categoryId) problems.push("Ana kategori Trendyol kategorisiyle eşleştirilmedi.");
  if (!s.cargoCompanyId) problems.push("Bağlantı ayarlarında kargo firması seçilmedi.");
  const prices = marketPrices(v, s);
  if (!prices) problems.push("Satış fiyatı yok.");
  // marketplaces take raster images only (jpg / png / webp), never SVG
  const images = v.images.filter((u) => u.startsWith("https://") && !/\.svg(\?|$)/i.test(u)).slice(0, 8);
  if (!images.length) problems.push("https adresli en az bir ürün görseli (JPG / PNG) gerekli.");

  const attributes: TrendyolItem["attributes"] = [];
  if (categoryId) {
    for (const rule of m.attributes.get(categoryId) ?? []) {
      if (rule.fixedValueId != null) attributes.push({ attributeId: rule.externalAttributeId, attributeValueId: rule.fixedValueId });
      else if (rule.fixedCustomValue) attributes.push({ attributeId: rule.externalAttributeId, customAttributeValue: rule.fixedCustomValue });
      else if (rule.attributeId) {
        const optionId = v.options[rule.attributeId];
        if (optionId) {
          const val = m.values.get(`${rule.externalAttributeId}:${optionId}`);
          if (val?.valueId != null) attributes.push({ attributeId: rule.externalAttributeId, attributeValueId: val.valueId });
          else if (val?.custom) attributes.push({ attributeId: rule.externalAttributeId, customAttributeValue: val.custom });
        } else if (v.texts[rule.attributeId]) {
          attributes.push({ attributeId: rule.externalAttributeId, customAttributeValue: v.texts[rule.attributeId]!.slice(0, 200) });
        }
      }
    }
    const sent = new Set(attributes.map((a) => a.attributeId));
    for (const req of (m.required.get(categoryId) ?? []).filter((a) => a.required && !sent.has(a.id))) problems.push(`Zorunlu Trendyol özelliği eksik: ${req.name}.`);
  }
  if (problems.length) return { problems };
  return {
    item: {
      barcode: v.barcode!, title: v.title.slice(0, 100), productMainId: v.productMainId.slice(0, 40), brandId: brandId!, categoryId: categoryId!,
      quantity: marketQuantity(v, s), stockCode: v.sku.slice(0, 100), dimensionalWeight: desi(v.weightGrams, v.dimensionsMm),
      description: (v.description || v.title).slice(0, 30_000), currencyType: "TRY", listPrice: prices!.listPrice, salePrice: prices!.salePrice,
      vatRate: Math.round(v.taxRateBps / 100), cargoCompanyId: s.cargoCompanyId!, deliveryOption: { deliveryDuration: s.deliveryDuration },
      ...(s.shipmentAddressId ? { shipmentAddressId: s.shipmentAddressId } : {}), ...(s.returningAddressId ? { returningAddressId: s.returningAddressId } : {}),
      images: images.map((url) => ({ url })), attributes,
    },
  };
}

// --- marketplace orders ------------------------------------------------------------------------------

/** A marketplace package (Trendyol: shipment package = what our system calls an order). */
export interface MarketplacePackage {
  packageId: string;
  orderNumber: string;
  status: string;
  lastModifiedMs: number;
  orderDateMs: number;
  customer: { name: string; email: string | null };
  shipping: { name: string; phone: string | null; city: string; district: string; line: string; postalCode: string | null };
  billing: { name: string; city: string; district: string; line: string; taxOffice: string | null; taxNumber: string | null; company: string | null } | null;
  lines: { barcode: string | null; sku: string | null; name: string; quantity: number; unitPriceMinor: number; discountMinor: number; vatRate: number; variantLabel: string }[];
  cargoTrackingNumber: string | null;
}

/** Marketplace package status → our order status; null = do not import (cancelled before we ever saw it). */
export function orderStatusOf(status: string): "paid" | "shipped" | "delivered" | null {
  switch (status) {
    case "Created": case "Picking": case "Invoiced": case "Awaiting": return "paid";
    case "Shipped": case "AtCollectionPoint": case "UnDelivered": return "shipped";
    case "Delivered": return "delivered";
    default: return null;
  }
}

const toMinor = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) : 0);

/** Trendyol getShipmentPackages content[] item → MarketplacePackage (defensive: missing fields become empty). */
export function parseTrendyolPackage(p: Record<string, unknown>): MarketplacePackage {
  const addr = (p.shipmentAddress ?? {}) as Record<string, unknown>;
  const inv = p.invoiceAddress as Record<string, unknown> | undefined;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
  const lines = Array.isArray(p.lines) ? (p.lines as Record<string, unknown>[]) : [];
  return {
    packageId: str(p.shipmentPackageId ?? p.id),
    orderNumber: str(p.orderNumber),
    status: str(p.shipmentPackageStatus ?? p.status),
    lastModifiedMs: Number(p.lastModifiedDate ?? p.orderDate ?? 0),
    orderDateMs: Number(p.orderDate ?? p.lastModifiedDate ?? 0),
    customer: { name: `${str(p.customerFirstName)} ${str(p.customerLastName)}`.trim(), email: str(p.customerEmail) || null },
    shipping: {
      name: str(addr.fullName) || `${str(addr.firstName)} ${str(addr.lastName)}`.trim(), phone: str(addr.phone) || null,
      city: str(addr.city), district: str(addr.district) || str(addr.countyName), line: str(addr.fullAddress) || `${str(addr.address1)} ${str(addr.address2)}`.trim(),
      postalCode: str(addr.postalCode) || null,
    },
    billing: inv ? {
      name: str(inv.fullName) || `${str(inv.firstName)} ${str(inv.lastName)}`.trim(), city: str(inv.city), district: str(inv.district) || str(inv.countyName),
      line: str(inv.fullAddress) || `${str(inv.address1)} ${str(inv.address2)}`.trim(), taxOffice: str(inv.taxOffice) || null, taxNumber: str(inv.taxNumber) || null, company: str(inv.company) || null,
    } : null,
    lines: lines.map((l) => {
      const qty = Math.max(1, Number(l.quantity ?? 1));
      const gross = typeof l.lineGrossAmount === "number" ? l.lineGrossAmount : typeof l.price === "number" ? (l.price as number) * qty : typeof l.amount === "number" ? (l.amount as number) : 0;
      const discount = typeof l.lineTotalDiscount === "number" ? l.lineTotalDiscount : typeof l.discount === "number" ? l.discount : 0;
      return {
        barcode: str(l.barcode) || null, sku: str(l.merchantSku ?? l.stockCode) || null, name: str(l.productName) || "Ürün", quantity: qty,
        unitPriceMinor: Math.round(toMinor(gross) / qty), discountMinor: toMinor(discount), vatRate: Number(l.vatRate ?? 20) || 0,
        variantLabel: [str(l.productColor), str(l.productSize)].filter(Boolean).join(" / "),
      };
    }),
    cargoTrackingNumber: str(p.cargoTrackingNumber) || null,
  };
}
