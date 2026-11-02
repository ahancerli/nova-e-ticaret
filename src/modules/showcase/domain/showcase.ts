/** Home page showcase (vitrin): sections, sliders and story collections — pure types and rules. */

export const SECTION_TYPES = {
  hero_slider: { label: "Büyük slider", hint: "Sayfanın üstünde dönen kampanya görselleri" },
  story_strip: { label: "Hikaye şeridi", hint: "Yuvarlak marka hikayeleri" },
  product_carousel: { label: "Ürün şeridi", hint: "Yana kayan ürün kartları" },
  product_grid: { label: "Ürün ızgarası", hint: "Satır satır ürün kartları" },
  category_tiles: { label: "Kategori kutuları", hint: "Seçili kategorilere kısayollar" },
  brand_strip: { label: "Marka şeridi", hint: "Seçili markaların logoları" },
  banner: { label: "Banner", hint: "Tek görsel, başlık ve bağlantı" },
} as const;
export type SectionType = keyof typeof SECTION_TYPES;
export const SECTION_TYPE_KEYS = Object.keys(SECTION_TYPES) as SectionType[];
export const isProductSection = (t: SectionType) => t === "product_carousel" || t === "product_grid";

export const SELECTION_MODES = {
  manual: "Elle seçilen ürünler",
  new: "En yeni ürünler",
  popular: "En çok satanlar",
  discounted: "İndirimdeki ürünler",
} as const;
export type SelectionMode = keyof typeof SELECTION_MODES;

export interface MediaRef {
  id: string;
  url: string;
}

export interface SectionRow {
  id: string;
  title: string;
  subtitle: string | null;
  type: SectionType;
  sliderId: string | null;
  storyCollectionId: string | null;
  selectionMode: SelectionMode;
  itemLimit: number;
  media: MediaRef | null;
  mobileMedia: MediaRef | null;
  targetUrl: string | null;
  ctaLabel: string | null;
  productIds: string[];
  categoryIds: string[];
  brandIds: string[];
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  updatedAt: string;
}

export interface SectionInput {
  title: string;
  subtitle?: string | null;
  type: SectionType;
  sliderId?: string | null;
  storyCollectionId?: string | null;
  selectionMode?: SelectionMode;
  itemLimit?: number;
  mediaId?: string | null;
  mobileMediaId?: string | null;
  targetUrl?: string | null;
  ctaLabel?: string | null;
  productIds?: string[];
  categoryIds?: string[];
  brandIds?: string[];
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface SlideRow {
  id: string;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  targetUrl: string | null;
  desktop: MediaRef;
  mobile: MediaRef | null;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
}

export interface SliderRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  slides: SlideRow[];
  usedBy: number;
}

export interface SlideInput {
  title: string;
  subtitle?: string | null;
  ctaLabel?: string | null;
  targetUrl?: string | null;
  desktopMediaId: string;
  mobileMediaId?: string | null;
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

export interface StoryFrameInput {
  mediaId: string;
  targetUrl?: string | null;
  durationMs: number;
}

export interface StoryRow {
  id: string;
  brandId: string;
  brandName: string;
  title: string;
  cover: MediaRef | null;
  frames: { media: MediaRef; targetUrl: string | null; durationMs: number }[];
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
}

export interface StoryCollectionRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  stories: StoryRow[];
  usedBy: number;
}

export interface StoryInput {
  brandId: string;
  title: string;
  coverMediaId?: string | null;
  frames: StoryFrameInput[];
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
}

/** What a section needs before it can be shown (checked on save; inactive drafts may be incomplete). */
export function sectionProblems(s: SectionInput): Record<string, string> {
  const p: Record<string, string> = {};
  if (s.endsAt && s.startsAt && s.endsAt <= s.startsAt) p.endsAt = "Bitiş, başlangıçtan sonra olmalı.";
  if (s.type === "hero_slider" && !s.sliderId) p.sliderId = "Bir slider seçin.";
  if (s.type === "story_strip" && !s.storyCollectionId) p.storyCollectionId = "Bir hikaye koleksiyonu seçin.";
  if (!s.isActive) return p;
  if (isProductSection(s.type) && (s.selectionMode ?? "manual") === "manual" && !s.productIds?.length) p.productIds = "En az bir ürün seçin ya da otomatik bir seçim kullanın.";
  if (s.type === "category_tiles" && !s.categoryIds?.length) p.categoryIds = "En az bir kategori seçin.";
  if (s.type === "brand_strip" && !s.brandIds?.length) p.brandIds = "En az bir marka seçin.";
  if (s.type === "banner" && !s.mediaId) p.mediaId = "Banner görseli yükleyin.";
  return p;
}

/** Section state for the admin list. */
export function sectionState(s: { isActive: boolean; startsAt: string | null; endsAt: string | null }, now: string): "live" | "scheduled" | "ended" | "off" {
  if (!s.isActive) return "off";
  if (s.endsAt && s.endsAt <= now) return "ended";
  if (s.startsAt && s.startsAt > now) return "scheduled";
  return "live";
}

/** Safe link: site path or https URL (same rule as the DB CHECK). */
export const isSafeLink = (v: string) => (v.startsWith("/") && !v.startsWith("//")) || v.startsWith("https://");
