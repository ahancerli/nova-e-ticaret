import type { Database } from "@/core";
import type { HomeSection } from "@/lib/types";
import { CARD_SELECT, toCard, type CardRow } from "./product-cards";

export interface HomeSectionRow {
  id: string;
  title: string;
  subtitle: string | null;
  section_type: string;
  slider_id: string | null;
  story_collection_id: string | null;
  selection_mode: string;
  item_limit: number;
  media_url: string | null;
  media_alt: string | null;
  mobile_media_url: string | null;
  target_url: string | null;
  cta_label: string | null;
}

/** Strategy: one loader per home_sections.section_type. New section type = one loader + one map entry. */
export interface HomeSectionLoader {
  load(db: Database, section: HomeSectionRow, now: string): Promise<HomeSection | null>;
}

const inWindow = (alias: string) => `(${alias}.starts_at IS NULL OR ${alias}.starts_at <= ?) AND (${alias}.ends_at IS NULL OR ${alias}.ends_at > ?)`;

class HeroSliderLoader implements HomeSectionLoader {
  async load(db: Database, sec: HomeSectionRow, now: string): Promise<HomeSection | null> {
    if (!sec.slider_id) return null;
    const rows = await db.all<{ id: string; title: string; subtitle: string | null; cta_label: string | null; target_url: string | null; desktop_url: string; alt_text: string; mobile_url: string | null }>(
      `SELECT s.id, s.title, s.subtitle, s.cta_label, s.target_url, d.public_url AS desktop_url, d.alt_text, mo.public_url AS mobile_url
         FROM slides s JOIN sliders sl ON sl.id = s.slider_id AND sl.is_active = 1
         JOIN media_assets d ON d.id = s.desktop_media_id
         LEFT JOIN media_assets mo ON mo.id = s.mobile_media_id
        WHERE s.slider_id = ? AND s.is_active = 1 AND ${inWindow("s")}
        ORDER BY s.sort_order`,
      sec.slider_id, now, now,
    );
    return {
      id: sec.id, type: "hero_slider", title: sec.title,
      slides: rows.map((r) => ({ id: r.id, title: r.title, subtitle: r.subtitle, ctaLabel: r.cta_label, href: r.target_url, desktopUrl: r.desktop_url, mobileUrl: r.mobile_url, alt: r.alt_text })),
    };
  }
}

class StoryStripLoader implements HomeSectionLoader {
  async load(db: Database, sec: HomeSectionRow, now: string): Promise<HomeSection | null> {
    if (!sec.story_collection_id) return null;
    const rows = await db.all<{ id: string; title: string; brand_slug: string; cover_url: string | null; frames: string }>(
      `SELECT st.id, st.title, b.slug AS brand_slug, m.public_url AS cover_url,
              (SELECT json_group_array(json_object('mediaUrl', fm.public_url, 'href', f.target_url, 'durationMs', f.duration_ms))
                 FROM (SELECT * FROM story_frames WHERE story_id = st.id ORDER BY sort_order) f
                 JOIN media_assets fm ON fm.id = f.media_id) AS frames
         FROM stories st JOIN brands b ON b.id = st.brand_id AND b.is_active = 1
         LEFT JOIN media_assets m ON m.id = st.cover_media_id
        WHERE st.collection_id = ? AND st.is_active = 1 AND ${inWindow("st")}
        ORDER BY st.sort_order`,
      sec.story_collection_id, now, now,
    );
    return {
      id: sec.id, type: "story_strip", title: sec.title,
      stories: rows.map((r) => ({ id: r.id, title: r.title, brandSlug: r.brand_slug, coverUrl: r.cover_url, frames: JSON.parse(r.frames ?? "[]") })),
    };
  }
}

/** Product carousel / grid; `selection_mode` picks the query (manual list, newest, discounted, best sellers). */
class ProductSectionLoader implements HomeSectionLoader {
  constructor(private readonly layout: "carousel" | "grid") {}

  async load(db: Database, sec: HomeSectionRow): Promise<HomeSection | null> {
    const limit = Math.min(Math.max(sec.item_limit || 12, 1), 48);
    const queries: Record<string, [string, unknown[]]> = {
      new: [`${CARD_SELECT} WHERE p.status = 'published' ORDER BY p.published_at DESC LIMIT ?`, [limit]],
      discounted: [`${CARD_SELECT} WHERE p.status = 'published' AND compare_at IS NOT NULL ORDER BY (compare_at - min_price) DESC LIMIT ?`, [limit]],
      popular: [`${CARD_SELECT} WHERE p.status = 'published'
                  ORDER BY (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id WHERE v.product_id = p.id) DESC
                  LIMIT ?`, [limit]],
    };
    const [sql, params] = queries[sec.selection_mode] ?? [
      `${CARD_SELECT} JOIN home_section_products hsp ON hsp.product_id = p.id AND hsp.section_id = ?
        WHERE p.status = 'published' ORDER BY hsp.sort_order LIMIT ?`,
      [sec.id, limit],
    ];
    const rows = await db.all<CardRow>(sql, ...params);
    if (!rows.length) return null;
    const moreHref = sec.selection_mode === "new" ? "/ara?sort=newest" : "/ara";
    return { id: sec.id, type: "products", title: sec.title, subtitle: sec.subtitle, layout: this.layout, products: rows.map(toCard), moreHref };
  }
}

/** Category tiles: the chosen active categories with their image. */
class CategoryTilesLoader implements HomeSectionLoader {
  async load(db: Database, sec: HomeSectionRow): Promise<HomeSection | null> {
    const rows = await db.all<{ id: string; name: string; slug: string; image_url: string | null }>(
      `SELECT c.id, c.name, c.slug, m.public_url AS image_url
         FROM home_section_categories hc JOIN categories c ON c.id = hc.category_id AND c.is_active = 1
         LEFT JOIN media_assets m ON m.id = c.image_media_id
        WHERE hc.section_id = ? ORDER BY hc.sort_order LIMIT ?`,
      sec.id, sec.item_limit,
    );
    if (!rows.length) return null;
    return { id: sec.id, type: "category_tiles", title: sec.title, subtitle: sec.subtitle, categories: rows.map((r) => ({ id: r.id, name: r.name, href: `/kategori/${r.slug}`, imageUrl: r.image_url })) };
  }
}

/** Brand strip: the chosen active brands with their logo. */
class BrandStripLoader implements HomeSectionLoader {
  async load(db: Database, sec: HomeSectionRow): Promise<HomeSection | null> {
    const rows = await db.all<{ id: string; name: string; slug: string; logo_url: string | null }>(
      `SELECT b.id, b.name, b.slug, m.public_url AS logo_url
         FROM home_section_brands hb JOIN brands b ON b.id = hb.brand_id AND b.is_active = 1
         LEFT JOIN media_assets m ON m.id = b.logo_media_id
        WHERE hb.section_id = ? ORDER BY hb.sort_order LIMIT ?`,
      sec.id, sec.item_limit,
    );
    if (!rows.length) return null;
    return { id: sec.id, type: "brand_strip", title: sec.title, subtitle: sec.subtitle, brands: rows.map((r) => ({ id: r.id, name: r.name, href: `/marka/${r.slug}`, logoUrl: r.logo_url })) };
  }
}

/** Banner: one image (optional mobile variant) with title, text and a link. */
class BannerLoader implements HomeSectionLoader {
  async load(_db: Database, sec: HomeSectionRow): Promise<HomeSection | null> {
    if (!sec.media_url) return null;
    return {
      id: sec.id, type: "banner", title: sec.title, subtitle: sec.subtitle, imageUrl: sec.media_url, mobileImageUrl: sec.mobile_media_url,
      alt: sec.media_alt ?? sec.title, href: sec.target_url, ctaLabel: sec.cta_label,
    };
  }
}

export const HOME_SECTION_LOADERS: Record<string, HomeSectionLoader> = {
  hero_slider: new HeroSliderLoader(),
  story_strip: new StoryStripLoader(),
  product_carousel: new ProductSectionLoader("carousel"),
  product_grid: new ProductSectionLoader("grid"),
  category_tiles: new CategoryTilesLoader(),
  brand_strip: new BrandStripLoader(),
  banner: new BannerLoader(),
};
