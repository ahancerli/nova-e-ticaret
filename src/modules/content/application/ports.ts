import type { Statement } from "@/core";
import type { FooterColumn, LegalType, PageDetail, PageKind, PageRevision, PageSeo, PageStatus, PageSummary } from "../domain/page";

/** Columns written on insert / update (already validated and normalised by the command). */
export interface PageRecord {
  slug: string;
  title: string;
  kind: PageKind;
  legalType: LegalType | null;
  summary: string | null;
  bodyHtml: string;
  status: PageStatus;
  footerColumn: FooterColumn | null;
  footerOrder: number;
  publishedAt: string | null;
}

export interface PublishedRow {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  bodyHtml: string;
  legalType: LegalType | null;
  version: number;
  updatedAt: string;
  seo: PageSeo;
}

export interface ContentRepository {
  list(): Promise<PageSummary[]>;
  find(id: string): Promise<PageDetail | null>;
  revisions(pageId: string): Promise<PageRevision[]>;
  revision(pageId: string, version: number): Promise<{ version: number; title: string; bodyHtml: string; createdAt: string } | null>;
  slugTaken(slug: string, exceptId: string | null): Promise<boolean>;
  /** Another non-archived page already holds this legal type. */
  legalTypeTaken(legalType: LegalType, exceptId: string | null): Promise<boolean>;

  findPublished(slug: string): Promise<PublishedRow | null>;
  footerLinks(): Promise<{ column: FooterColumn; title: string; slug: string }[]>;
  publishedLegal(types: LegalType[]): Promise<{ legalType: LegalType; slug: string; title: string; version: number }[]>;

  insertStatement(id: string, page: PageRecord, actorId: string, now: string): Statement;
  /** Guarded by the version the editor loaded: 0 rows changed = someone else saved in between. */
  updateStatement(id: string, page: PageRecord, expectedVersion: number, actorId: string, now: string): Statement;
  insertRevisionStatement(r: { id: string; pageId: string; version: number; title: string; bodyHtml: string; status: PageStatus; actorId: string; now: string }): Statement;
  replaceSeoStatements(pageId: string, seo: PageSeo | null, newId: () => string): Statement[];
  deleteStatement(id: string, expectedVersion: number): Statement;
}
