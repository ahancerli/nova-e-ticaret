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
  /** Automatic campaigns that apply to the product (badge on the card). */
  promotions: PromotionBadge[];
  /** One unit's price in the cart after unconditional product campaigns; null = no such campaign. */
  campaignPriceMinor: number | null;
}

/** A campaign as shoppers see it: emoji or image + short text ("🔥 3 Al 2 Öde"). */
export interface PromotionBadge {
  campaignId: string;
  kind: string;
  label: string;
  emoji: string | null;
  imageUrl: string | null;
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
  variants: { id: string; sku: string; isDefault: boolean; priceMinor: number | null; compareAtMinor: number | null; campaignPriceMinor: number | null; available: number; options: Record<string, string> }[];
  promotions: PromotionBadge[];
  axes: { code: string; label: string; style: "button" | "swatch" | "dropdown"; options: { value: string; label: string; colorHex: string | null }[] }[];
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
  | { id: string; type: "products"; title: string; subtitle: string | null; layout: "carousel" | "grid"; products: ProductCard[]; moreHref: string }
  | { id: string; type: "category_tiles"; title: string; subtitle: string | null; categories: { id: string; name: string; href: string; imageUrl: string | null }[] }
  | { id: string; type: "brand_strip"; title: string; subtitle: string | null; brands: { id: string; name: string; href: string; logoUrl: string | null }[] }
  | { id: string; type: "banner"; title: string; subtitle: string | null; imageUrl: string; mobileImageUrl: string | null; alt: string; href: string | null; ctaLabel: string | null };

export interface HomeData {
  sections: HomeSection[];
}

/** Active category tree for the storefront (mega menu, mobile menu, category directory). */
export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  href: string;
  imageUrl: string | null;
  /** Wide visual shown inside the mega menu panel (Kategoriler → "Menü görseli"). */
  menuImageUrl: string | null;
  children: CategoryNode[];
}

export interface SearchSuggestions {
  products: ProductCard[];
  categories: { name: string; href: string }[];
  brands: { name: string; href: string }[];
}

export interface QuoteLine {
  cartItemId: string;
  variantId: string;
  productId: string;
  productSlug: string | null;
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
  /** Pipeline stage that produced it (product → cart → coupon → shipping). */
  stage: "product" | "cart" | "coupon" | "shipping";
  badge: PromotionBadge;
  rule: Record<string, unknown>;
}

/** Discount per applied campaign (cart / checkout summary rows). */
export interface QuotePromotion {
  campaignId: string;
  name: string;
  badge: PromotionBadge;
  stage: QuoteAdjustment["stage"];
  amountMinor: number;
  /** Set when it came from the entered coupon. */
  couponCode: string | null;
}

export interface Quote {
  currency: "TRY";
  lines: QuoteLine[];
  adjustments: QuoteAdjustment[];
  promotions: QuotePromotion[];
  couponCode: string | null;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  itemCount: number;
  warnings: { code: string; message: string; variantId?: string }[];
}
