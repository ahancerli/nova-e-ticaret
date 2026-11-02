import { Repository, bit, placeholders, type Statement } from "@/core";
import type { ShowcaseRepository } from "../application/ports";
import type { MediaRef, SectionInput, SectionRow, SectionType, SelectionMode, SlideInput, SliderRow, StoryCollectionRow, StoryInput } from "../domain/showcase";

const media = (id: string | null, url: string | null): MediaRef | null => (id && url ? { id, url } : null);
const ids = (json: string | null) => (JSON.parse(json ?? "[]") as string[]);

type SectionRaw = {
  id: string; title: string; subtitle: string | null; section_type: SectionType; slider_id: string | null; story_collection_id: string | null;
  selection_mode: SelectionMode; item_limit: number; media_id: string | null; media_url: string | null; mobile_media_id: string | null; mobile_url: string | null;
  target_url: string | null; cta_label: string | null; is_active: number; starts_at: string | null; ends_at: string | null; sort_order: number; updated_at: string;
  product_ids: string; category_ids: string; brand_ids: string;
};

export class D1ShowcaseRepository extends Repository implements ShowcaseRepository {
  // --- sections ---------------------------------------------------------------------------------------
  async sections(): Promise<SectionRow[]> {
    const rows = await this.db.all<SectionRaw>(
      `SELECT h.*, m.public_url AS media_url, mm.public_url AS mobile_url,
              COALESCE((SELECT json_group_array(product_id) FROM (SELECT product_id FROM home_section_products WHERE section_id = h.id ORDER BY sort_order)), '[]') AS product_ids,
              COALESCE((SELECT json_group_array(category_id) FROM (SELECT category_id FROM home_section_categories WHERE section_id = h.id ORDER BY sort_order)), '[]') AS category_ids,
              COALESCE((SELECT json_group_array(brand_id) FROM (SELECT brand_id FROM home_section_brands WHERE section_id = h.id ORDER BY sort_order)), '[]') AS brand_ids
         FROM home_sections h
         LEFT JOIN media_assets m ON m.id = h.media_id
         LEFT JOIN media_assets mm ON mm.id = h.mobile_media_id
        WHERE h.section_type <> 'recently_viewed'
        ORDER BY h.sort_order, h.id`,
    );
    return rows.map((r) => ({
      id: r.id, title: r.title, subtitle: r.subtitle, type: r.section_type, sliderId: r.slider_id, storyCollectionId: r.story_collection_id,
      selectionMode: r.selection_mode, itemLimit: r.item_limit, media: media(r.media_id, r.media_url), mobileMedia: media(r.mobile_media_id, r.mobile_url),
      targetUrl: r.target_url, ctaLabel: r.cta_label, productIds: ids(r.product_ids), categoryIds: ids(r.category_ids), brandIds: ids(r.brand_ids),
      isActive: r.is_active === 1, startsAt: r.starts_at, endsAt: r.ends_at, sortOrder: r.sort_order, updatedAt: r.updated_at,
    }));
  }

  async countExisting(table: "products" | "categories" | "brands" | "sliders" | "story_collections", refIds: string[]): Promise<number> {
    if (!refIds.length) return 0;
    const r = await this.db.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE id IN (${placeholders(refIds.length)})`, ...refIds);
    return r?.n ?? 0;
  }

  async nextSortOrder(): Promise<number> {
    return ((await this.db.first<{ n: number | null }>("SELECT MAX(sort_order) AS n FROM home_sections"))?.n ?? 0) + 1;
  }

  insertSectionStatement(id: string, s: SectionInput, sortOrder: number, now: string): Statement {
    return this.db.statement(
      `INSERT INTO home_sections (id, title, subtitle, section_type, slider_id, story_collection_id, selection_mode, item_limit, media_id, mobile_media_id,
                                  target_url, cta_label, sort_order, is_active, starts_at, ends_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, s.title, s.subtitle ?? null, s.type, s.sliderId ?? null, s.storyCollectionId ?? null, s.selectionMode ?? "manual", s.itemLimit ?? 12,
      s.mediaId ?? null, s.mobileMediaId ?? null, s.targetUrl ?? null, s.ctaLabel ?? null, sortOrder, bit(s.isActive), s.startsAt ?? null, s.endsAt ?? null, now,
    );
  }

  updateSectionStatement(id: string, s: SectionInput, expectedUpdatedAt: string, now: string): Statement {
    return this.db.statement(
      `UPDATE home_sections SET title = ?, subtitle = ?, slider_id = ?, story_collection_id = ?, selection_mode = ?, item_limit = ?, media_id = ?, mobile_media_id = ?,
              target_url = ?, cta_label = ?, is_active = ?, starts_at = ?, ends_at = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?`,
      s.title, s.subtitle ?? null, s.sliderId ?? null, s.storyCollectionId ?? null, s.selectionMode ?? "manual", s.itemLimit ?? 12, s.mediaId ?? null, s.mobileMediaId ?? null,
      s.targetUrl ?? null, s.ctaLabel ?? null, bit(s.isActive), s.startsAt ?? null, s.endsAt ?? null, now, id, expectedUpdatedAt,
    );
  }

  replaceSectionItemsStatements(id: string, s: SectionInput): Statement[] {
    const out = [
      this.db.statement("DELETE FROM home_section_products WHERE section_id = ?", id),
      this.db.statement("DELETE FROM home_section_categories WHERE section_id = ?", id),
      this.db.statement("DELETE FROM home_section_brands WHERE section_id = ?", id),
    ];
    (s.productIds ?? []).forEach((p, i) => out.push(this.db.statement("INSERT INTO home_section_products (section_id, product_id, sort_order) VALUES (?, ?, ?)", id, p, i)));
    (s.categoryIds ?? []).forEach((c, i) => out.push(this.db.statement("INSERT INTO home_section_categories (section_id, category_id, sort_order) VALUES (?, ?, ?)", id, c, i)));
    (s.brandIds ?? []).forEach((b, i) => out.push(this.db.statement("INSERT INTO home_section_brands (section_id, brand_id, sort_order) VALUES (?, ?, ?)", id, b, i)));
    return out;
  }

  setSectionActiveStatement(id: string, active: boolean, now: string): Statement {
    return this.db.statement("UPDATE home_sections SET is_active = ?, updated_at = ? WHERE id = ?", bit(active), now, id);
  }

  sortSectionStatement(id: string, sortOrder: number): Statement {
    return this.db.statement("UPDATE home_sections SET sort_order = ? WHERE id = ?", sortOrder, id);
  }

  deleteSectionStatement(id: string): Statement {
    return this.db.statement("DELETE FROM home_sections WHERE id = ?", id);
  }

  // --- sliders ------------------------------------------------------------------------------------------
  async sliders(): Promise<SliderRow[]> {
    const [sliders, slides] = await Promise.all([
      this.db.all<{ id: string; code: string; name: string; is_active: number; used_by: number }>(
        "SELECT s.*, (SELECT COUNT(*) FROM home_sections h WHERE h.slider_id = s.id) AS used_by FROM sliders s ORDER BY s.name COLLATE NOCASE",
      ),
      this.db.all<{ id: string; slider_id: string; title: string; subtitle: string | null; cta_label: string | null; target_url: string | null; desktop_media_id: string; d_url: string;
        mobile_media_id: string | null; m_url: string | null; is_active: number; starts_at: string | null; ends_at: string | null; sort_order: number }>(
        `SELECT sl.*, d.public_url AS d_url, m.public_url AS m_url FROM slides sl
           JOIN media_assets d ON d.id = sl.desktop_media_id LEFT JOIN media_assets m ON m.id = sl.mobile_media_id
          ORDER BY sl.sort_order, sl.id`,
      ),
    ]);
    return sliders.map((s) => ({
      id: s.id, code: s.code, name: s.name, isActive: s.is_active === 1, usedBy: s.used_by,
      slides: slides.filter((x) => x.slider_id === s.id).map((x) => ({
        id: x.id, title: x.title, subtitle: x.subtitle, ctaLabel: x.cta_label, targetUrl: x.target_url, desktop: { id: x.desktop_media_id, url: x.d_url },
        mobile: media(x.mobile_media_id, x.m_url), isActive: x.is_active === 1, startsAt: x.starts_at, endsAt: x.ends_at, sortOrder: x.sort_order,
      })),
    }));
  }

  async slide(id: string) {
    const r = await this.db.first<{ slider_id: string; desktop_media_id: string; mobile_media_id: string | null }>("SELECT slider_id, desktop_media_id, mobile_media_id FROM slides WHERE id = ?", id);
    return r ? { sliderId: r.slider_id, desktopMediaId: r.desktop_media_id, mobileMediaId: r.mobile_media_id } : null;
  }

  insertSliderStatement(id: string, code: string, name: string): Statement {
    return this.db.statement("INSERT INTO sliders (id, code, name, is_active) VALUES (?, ?, ?, 1)", id, code, name);
  }

  deleteSliderStatement(id: string): Statement {
    return this.db.statement("DELETE FROM sliders WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM home_sections WHERE slider_id = ?1)", id);
  }

  async nextSlideOrder(sliderId: string): Promise<number> {
    return ((await this.db.first<{ n: number | null }>("SELECT MAX(sort_order) AS n FROM slides WHERE slider_id = ?", sliderId))?.n ?? 0) + 1;
  }

  insertSlideStatement(id: string, sliderId: string, s: SlideInput, sortOrder: number): Statement {
    return this.db.statement(
      `INSERT INTO slides (id, slider_id, title, subtitle, desktop_media_id, mobile_media_id, cta_label, target_url, sort_order, starts_at, ends_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, sliderId, s.title, s.subtitle ?? null, s.desktopMediaId, s.mobileMediaId ?? null, s.ctaLabel ?? null, s.targetUrl ?? null, sortOrder, s.startsAt ?? null, s.endsAt ?? null, bit(s.isActive),
    );
  }

  updateSlideStatement(id: string, s: SlideInput): Statement {
    return this.db.statement(
      `UPDATE slides SET title = ?, subtitle = ?, desktop_media_id = ?, mobile_media_id = ?, cta_label = ?, target_url = ?, starts_at = ?, ends_at = ?, is_active = ? WHERE id = ?`,
      s.title, s.subtitle ?? null, s.desktopMediaId, s.mobileMediaId ?? null, s.ctaLabel ?? null, s.targetUrl ?? null, s.startsAt ?? null, s.endsAt ?? null, bit(s.isActive), id,
    );
  }

  sortSlideStatement(id: string, sliderId: string, sortOrder: number): Statement {
    return this.db.statement("UPDATE slides SET sort_order = ? WHERE id = ? AND slider_id = ?", sortOrder, id, sliderId);
  }

  deleteSlideStatement(id: string): Statement {
    return this.db.statement("DELETE FROM slides WHERE id = ?", id);
  }

  // --- stories -----------------------------------------------------------------------------------------
  async collections(): Promise<StoryCollectionRow[]> {
    const [cols, stories] = await Promise.all([
      this.db.all<{ id: string; name: string; slug: string; is_active: number; used_by: number }>(
        "SELECT c.*, (SELECT COUNT(*) FROM home_sections h WHERE h.story_collection_id = c.id) AS used_by FROM story_collections c ORDER BY c.name COLLATE NOCASE",
      ),
      this.db.all<{ id: string; collection_id: string; brand_id: string; brand_name: string; title: string; cover_media_id: string | null; cover_url: string | null;
        is_active: number; starts_at: string | null; ends_at: string | null; sort_order: number; frames: string }>(
        `SELECT st.*, b.name AS brand_name, m.public_url AS cover_url,
                COALESCE((SELECT json_group_array(json_object('mediaId', f.media_id, 'url', fm.public_url, 'targetUrl', f.target_url, 'durationMs', f.duration_ms))
                            FROM (SELECT * FROM story_frames WHERE story_id = st.id ORDER BY sort_order) f JOIN media_assets fm ON fm.id = f.media_id), '[]') AS frames
           FROM stories st JOIN brands b ON b.id = st.brand_id LEFT JOIN media_assets m ON m.id = st.cover_media_id
          ORDER BY st.sort_order, st.id`,
      ),
    ]);
    return cols.map((c) => ({
      id: c.id, name: c.name, slug: c.slug, isActive: c.is_active === 1, usedBy: c.used_by,
      stories: stories.filter((s) => s.collection_id === c.id).map((s) => ({
        id: s.id, brandId: s.brand_id, brandName: s.brand_name, title: s.title, cover: media(s.cover_media_id, s.cover_url),
        frames: (JSON.parse(s.frames) as { mediaId: string; url: string; targetUrl: string | null; durationMs: number }[])
          .map((f) => ({ media: { id: f.mediaId, url: f.url }, targetUrl: f.targetUrl, durationMs: f.durationMs })),
        isActive: s.is_active === 1, startsAt: s.starts_at, endsAt: s.ends_at, sortOrder: s.sort_order,
      })),
    }));
  }

  async storyMedia(id: string): Promise<{ collectionId: string; mediaIds: string[] } | null> {
    const r = await this.db.first<{ collection_id: string; cover_media_id: string | null; frames: string }>(
      "SELECT collection_id, cover_media_id, COALESCE((SELECT json_group_array(media_id) FROM story_frames WHERE story_id = ?1), '[]') AS frames FROM stories WHERE id = ?1", id,
    );
    return r ? { collectionId: r.collection_id, mediaIds: [r.cover_media_id, ...ids(r.frames)].filter((x): x is string => !!x) } : null;
  }

  insertCollectionStatement(id: string, name: string, slug: string): Statement {
    return this.db.statement("INSERT INTO story_collections (id, name, slug, is_active) VALUES (?, ?, ?, 1)", id, name, slug);
  }

  deleteCollectionStatement(id: string): Statement {
    return this.db.statement("DELETE FROM story_collections WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM home_sections WHERE story_collection_id = ?1)", id);
  }

  async nextStoryOrder(collectionId: string): Promise<number> {
    return ((await this.db.first<{ n: number | null }>("SELECT MAX(sort_order) AS n FROM stories WHERE collection_id = ?", collectionId))?.n ?? 0) + 1;
  }

  saveStoryStatements(id: string, collectionId: string, s: StoryInput, sortOrder: number | null, newId: () => string): Statement[] {
    const head = sortOrder === null
      ? this.db.statement("UPDATE stories SET brand_id = ?, title = ?, cover_media_id = ?, starts_at = ?, ends_at = ?, is_active = ? WHERE id = ? AND collection_id = ?",
        s.brandId, s.title, s.coverMediaId ?? null, s.startsAt ?? null, s.endsAt ?? null, bit(s.isActive), id, collectionId)
      : this.db.statement("INSERT INTO stories (id, collection_id, brand_id, title, cover_media_id, sort_order, starts_at, ends_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id, collectionId, s.brandId, s.title, s.coverMediaId ?? null, sortOrder, s.startsAt ?? null, s.endsAt ?? null, bit(s.isActive));
    return [
      head,
      this.db.statement("DELETE FROM story_frames WHERE story_id = ?", id),
      ...s.frames.map((f, i) => this.db.statement(
        "INSERT INTO story_frames (id, story_id, media_id, target_url, duration_ms, sort_order) VALUES (?, ?, ?, ?, ?, ?)", newId(), id, f.mediaId, f.targetUrl ?? null, f.durationMs, i,
      )),
    ];
  }

  sortStoryStatement(id: string, collectionId: string, sortOrder: number): Statement {
    return this.db.statement("UPDATE stories SET sort_order = ? WHERE id = ? AND collection_id = ?", sortOrder, id, collectionId);
  }

  deleteStoryStatement(id: string): Statement {
    return this.db.statement("DELETE FROM stories WHERE id = ?", id);
  }
}
