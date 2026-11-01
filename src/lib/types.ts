// Shared DTOs between server services, API routes and client components.

export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  brandName: string | null;
  brandSlug: string | null;
  imageUrl: string | null;
  imageAlt: string;
  priceMinor: number | null;
  compareAtMinor: number | null;
  defaultVariantId: string | null;
  hasVariants: boolean;
  inStock: boolean;
  rating: number | null;
  ratingCount: number;
}

export interface ProductDetail {
  id: string;
  slug: string;
  name: string;
  brandName: string | null;
  brandSlug: string | null;
  shortDescription: string | null;
  descriptionHtml: string | null;
  media: { variantId: string | null; url: string; alt: string }[];
  variants: { id: string; sku: string; isDefault: boolean; priceMinor: number | null; compareAtMinor: number | null; available: number; options: Record<string, string> }[];
  axes: { code: string; label: string; options: { value: string; label: string; colorHex: string | null }[] }[];
  specs: { label: string; value: string }[];
  related: ProductCard[];
  breadcrumb: { name: string; slug: string }[];
}

export interface Facets {
  brands: { value: string; label: string; count: number; selected: boolean }[];
  attributes: { code: string; label: string; options: { value: string; label: string; colorHex: string | null; count: number; selected: boolean }[] }[];
  price: { minMinor: number; maxMinor: number };
}

export type HomeSection =
  | { id: string; type: "hero_slider"; title: string; slides: { id: string; title: string; subtitle: string | null; ctaLabel: string | null; href: string | null; desktopUrl: string; mobileUrl: string | null; alt: string }[] }
  | { id: string; type: "story_strip"; title: string; stories: { id: string; title: string; brandSlug: string; coverUrl: string | null; frames: { mediaUrl: string; href: string | null; durationMs: number }[] }[] }
  | { id: string; type: "products"; title: string; layout: "carousel" | "grid"; products: ProductCard[] };

export interface HomeData {
  sections: HomeSection[];
}

export interface QuoteLine {
  cartItemId: string;
  variantId: string;
  productId: string;
  sku: string;
  productName: string;
  variantLabel: string;
  imageUrl: string | null;
  quantity: number;
  available: number;
  unitPriceMinor: number;
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  taxRateBps: number;
  taxMinor: number;
}

export interface QuoteAdjustment {
  campaignId: string | null;
  couponId: string | null;
  label: string;
  amountMinor: number;
  target: "item" | "order" | "shipping";
  lineVariantId: string | null;
  units: number;
  rule: Record<string, unknown>;
}

export interface Quote {
  currency: "TRY";
  lines: QuoteLine[];
  adjustments: QuoteAdjustment[];
  couponCode: string | null;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  itemCount: number;
  warnings: { code: string; message: string; variantId?: string }[];
}
