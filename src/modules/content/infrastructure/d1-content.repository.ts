import { Repository, bit, bool, placeholders, type Statement } from "@/core";
import type { ContentRepository, PageRecord, PublishedRow } from "../application/ports";
import type { FooterColumn, LegalType, PageDetail, PageKind, PageRevision, PageSeo, PageStatus, PageSummary } from "../domain/page";

type Raw = {
  id: string; slug: string; title: string; kind: PageKind; legal_type: LegalType | null; summary: string | null; body_html: string;
  status: PageStatus; footer_column: FooterColumn | null; footer_order: number; version: number; published_at: string | null;
  created_at: string; updated_at: string; updated_by_name: string | null;
  meta_title: string | null; meta_description: string | null; noindex: number | null;
};

const SELECT = `
  SELECT p.*, u.display_name AS updated_by_name, s.meta_title, s.meta_description, s.noindex
    FROM content_pages p
    LEFT JOIN users u ON u.id = p.updated_by
    LEFT JOIN seo_documents s ON s.page_id = p.id`;

const summaryOf = (r: Raw): PageSummary => ({
  id: r.id, slug: r.slug, title: r.title, kind: r.kind, legalType: r.legal_type, status: r.status,
  footerColumn: r.footer_column, footerOrder: r.footer_order, version: r.version, publishedAt: r.published_at,
  updatedAt: r.updated_at, updatedByName: r.updated_by_name,
});
const seoOf = (r: Raw): PageSeo => ({ metaTitle: r.meta_title, metaDescription: r.meta_description, noindex: bool(r.noindex ?? 0) });

export class D1ContentRepository extends Repository implements ContentRepository {
  async list(): Promise<PageSummary[]> {
    return (await this.db.all<Raw>(`${SELECT} ORDER BY CASE p.kind WHEN 'legal' THEN 0 WHEN 'corporate' THEN 1 WHEN 'help' THEN 2 ELSE 3 END, p.title COLLATE NOCASE`)).map(summaryOf);
  }

  async find(id: string): Promise<PageDetail | null> {
    const r = await this.db.first<Raw>(`${SELECT} WHERE p.id = ?`, id);
    return r ? { ...summaryOf(r), summary: r.summary, bodyHtml: r.body_html, seo: seoOf(r), createdAt: r.created_at } : null;
  }

  async revisions(pageId: string): Promise<PageRevision[]> {
    const rows = await this.db.all<{ version: number; title: string; status: PageStatus; created_at: string; name: string | null }>(
      `SELECT r.version, r.title, r.status, r.created_at, u.display_name AS name
         FROM content_page_revisions r LEFT JOIN users u ON u.id = r.created_by
        WHERE r.page_id = ? ORDER BY r.version DESC LIMIT 50`, pageId,
    );
    return rows.map((r) => ({ version: r.version, title: r.title, status: r.status, createdAt: r.created_at, createdByName: r.name }));
  }

  async revision(pageId: string, version: number) {
    const r = await this.db.first<{ version: number; title: string; body_html: string; created_at: string }>(
      "SELECT version, title, body_html, created_at FROM content_page_revisions WHERE page_id = ? AND version = ?", pageId, version,
    );
    return r ? { version: r.version, title: r.title, bodyHtml: r.body_html, createdAt: r.created_at } : null;
  }

  async slugTaken(slug: string, exceptId: string | null): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS hit FROM content_pages WHERE slug = ? AND (? IS NULL OR id <> ?)", slug, exceptId, exceptId)) !== null;
  }

  async legalTypeTaken(legalType: LegalType, exceptId: string | null): Promise<boolean> {
    return (await this.db.first(
      "SELECT 1 AS hit FROM content_pages WHERE legal_type = ? AND status <> 'archived' AND (? IS NULL OR id <> ?)", legalType, exceptId, exceptId,
    )) !== null;
  }

  async findPublished(slug: string): Promise<PublishedRow | null> {
    const r = await this.db.first<Raw>(`${SELECT} WHERE p.slug = ? AND p.status = 'published'`, slug);
    return r ? { id: r.id, slug: r.slug, title: r.title, summary: r.summary, bodyHtml: r.body_html, legalType: r.legal_type, version: r.version, updatedAt: r.updated_at, seo: seoOf(r) } : null;
  }

  footerLinks() {
    return this.db.all<{ column: FooterColumn; title: string; slug: string }>(
      `SELECT footer_column AS "column", title, slug FROM content_pages
        WHERE status = 'published' AND footer_column IS NOT NULL ORDER BY footer_order, title COLLATE NOCASE`,
    );
  }

  async publishedLegal(types: LegalType[]) {
    if (!types.length) return [];
    return this.db.all<{ legalType: LegalType; slug: string; title: string; version: number }>(
      `SELECT legal_type AS legalType, slug, title, version FROM content_pages
        WHERE status = 'published' AND legal_type IN (${placeholders(types.length)})`, ...types,
    );
  }

  insertStatement(id: string, p: PageRecord, actorId: string, now: string): Statement {
    return this.db.statement(
      `INSERT INTO content_pages (id, slug, title, kind, legal_type, summary, body_html, status, footer_column, footer_order, version,
                                  published_at, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      id, p.slug, p.title, p.kind, p.legalType, p.summary, p.bodyHtml, p.status, p.footerColumn, p.footerOrder,
      p.publishedAt, actorId, actorId, now, now,
    );
  }

  updateStatement(id: string, p: PageRecord, expectedVersion: number, actorId: string, now: string): Statement {
    return this.db.statement(
      `UPDATE content_pages
          SET slug = ?, title = ?, kind = ?, legal_type = ?, summary = ?, body_html = ?, status = ?, footer_column = ?, footer_order = ?,
              published_at = ?, version = version + 1, updated_by = ?, updated_at = ?
        WHERE id = ? AND version = ?`,
      p.slug, p.title, p.kind, p.legalType, p.summary, p.bodyHtml, p.status, p.footerColumn, p.footerOrder,
      p.publishedAt, actorId, now, id, expectedVersion,
    );
  }

  insertRevisionStatement(r: Parameters<ContentRepository["insertRevisionStatement"]>[0]): Statement {
    return this.db.statement(
      "INSERT INTO content_page_revisions (id, page_id, version, title, body_html, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      r.id, r.pageId, r.version, r.title, r.bodyHtml, r.status, r.actorId, r.now,
    );
  }

  replaceSeoStatements(pageId: string, seo: PageSeo | null, newId: () => string): Statement[] {
    const del = this.db.statement("DELETE FROM seo_documents WHERE page_id = ?", pageId);
    if (!seo) return [del];
    return [
      del,
      this.db.statement(
        "INSERT INTO seo_documents (id, page_id, meta_title, meta_description, noindex) VALUES (?, ?, ?, ?, ?)",
        newId(), pageId, seo.metaTitle, seo.metaDescription, bit(seo.noindex),
      ),
    ];
  }

  deleteStatement(id: string, expectedVersion: number): Statement {
    return this.db.statement("DELETE FROM content_pages WHERE id = ? AND version = ?", id, expectedVersion);
  }
}
