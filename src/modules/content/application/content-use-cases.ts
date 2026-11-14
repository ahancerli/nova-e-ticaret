import { UnitOfWork, sanitizeRichHtml, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { Actor } from "@/modules/shared/actor";
import { normalizeSlug } from "@/modules/shared/slug";
import { ContentErrors } from "../domain/errors";
import {
  FOOTER_COLUMNS, LEGAL_TYPES, pageHref,
  type CheckoutLegal, type FooterLinkColumn, type LegalType, type SignupLegal, type PageDetail, type PageInput, type PagePatch, type PageRevision, type PageSeo, type PageSummary, type PublishedPage,
} from "../domain/page";
import { renderTemplate } from "../domain/template";
import type { ContentRepository, PageRecord } from "./ports";

/** Port to the settings module: values for {{placeholders}}. */
export interface TemplateVariableSource {
  execute(): Promise<Record<string, string>>;
}

export interface ContentCommandDeps {
  db: Database;
  pages: ContentRepository;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
}

const textOrNull = (v: string | null | undefined) => v?.trim() || null;
const hasText = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "").length > 0;

function seoOrNull(seo: Partial<PageSeo> | undefined): PageSeo | null {
  const s = { metaTitle: textOrNull(seo?.metaTitle), metaDescription: textOrNull(seo?.metaDescription), noindex: seo?.noindex ?? false };
  return s.metaTitle || s.metaDescription || s.noindex ? s : null;
}

abstract class PageCommand {
  constructor(protected readonly deps: ContentCommandDeps) {}

  /** Validates and normalises a complete page (create, or existing page + patch). */
  protected async record(input: PageInput, existing: PageDetail | null, now: string): Promise<PageRecord> {
    const legalType = input.kind === "legal" ? input.legalType ?? null : null;
    if (input.kind === "legal" && !legalType) throw ContentErrors.legalTypeRequired();
    if (input.kind !== "legal" && input.legalType) throw ContentErrors.legalTypeOnlyForLegal();

    const slug = normalizeSlug(input.slug?.trim() || input.title);
    if (await this.deps.pages.slugTaken(slug, existing?.id ?? null)) throw ContentErrors.slugTaken();
    if (legalType && input.status !== "archived" && await this.deps.pages.legalTypeTaken(legalType, existing?.id ?? null)) {
      throw ContentErrors.legalTypeTaken(LEGAL_TYPES[legalType].label);
    }

    const bodyHtml = sanitizeRichHtml(input.bodyHtml);
    if (!hasText(bodyHtml)) throw ContentErrors.emptyBody();

    // published_at = when the current publication started; kept after unpublishing (a legal text that was ever
    // public stays undeletable).
    const publishedAt = input.status === "published"
      ? (existing?.status === "published" ? existing.publishedAt : now)
      : existing?.publishedAt ?? null;

    return {
      slug, title: input.title.trim(), kind: input.kind, legalType, summary: textOrNull(input.summary), bodyHtml, status: input.status,
      footerColumn: input.footerColumn ?? null, footerOrder: input.footerOrder ?? 0, publishedAt,
    };
  }
}

/** Command: new page (version 1 + its first revision + SEO + audit, one transaction). */
export class CreatePage extends PageCommand {
  async execute(input: PageInput, actor: Actor): Promise<{ id: string; slug: string }> {
    const now = this.deps.clock.nowIso();
    const page = await this.record(input, null, now);
    const id = this.deps.ids.newId();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.pages.insertStatement(id, page, actor.userId, now))
      .add(this.deps.pages.insertRevisionStatement({ id: this.deps.ids.newId(), pageId: id, version: 1, title: page.title, bodyHtml: page.bodyHtml, status: page.status, actorId: actor.userId, now }))
      .add(...this.deps.pages.replaceSeoStatements(id, seoOrNull(input.seo), () => this.deps.ids.newId()))
      .add(this.deps.audit.recordStatement({ actor, action: "content.create", entityType: "content_page", entityId: id, diff: { title: page.title, slug: page.slug, kind: page.kind, legalType: page.legalType, status: page.status } }))
      .commit();
    return { id, slug: page.slug };
  }
}

/**
 * Command: update with optimistic locking on `version`. Every saved version is kept in content_page_revisions,
 * so the exact text a customer accepted at checkout stays provable.
 */
export class UpdatePage extends PageCommand {
  async execute(id: string, patch: PagePatch, actor: Actor): Promise<{ version: number; slug: string }> {
    const existing = await this.deps.pages.find(id);
    if (!existing) throw ContentErrors.notFound();
    if (existing.version !== patch.expectedVersion) throw ContentErrors.changedMeanwhile();

    const { expectedVersion, seo, ...fields } = patch;
    const merged: PageInput = {
      title: existing.title, slug: existing.slug, kind: existing.kind, legalType: existing.legalType, summary: existing.summary,
      bodyHtml: existing.bodyHtml, status: existing.status, footerColumn: existing.footerColumn, footerOrder: existing.footerOrder,
      ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
    };
    if (fields.kind && fields.kind !== "legal" && fields.legalType === undefined) merged.legalType = null;

    const now = this.deps.clock.nowIso();
    const page = await this.record(merged, existing, now);
    const version = expectedVersion + 1;
    const uow = new UnitOfWork(this.deps.db)
      .add(this.deps.pages.updateStatement(id, page, expectedVersion, actor.userId, now))
      .expectChanges(1, ContentErrors.changedMeanwhile)
      .add(this.deps.pages.insertRevisionStatement({ id: this.deps.ids.newId(), pageId: id, version, title: page.title, bodyHtml: page.bodyHtml, status: page.status, actorId: actor.userId, now }));
    if (seo !== undefined) uow.add(...this.deps.pages.replaceSeoStatements(id, seoOrNull(seo), () => this.deps.ids.newId()));
    await uow
      .add(this.deps.audit.recordStatement({
        actor, action: "content.update", entityType: "content_page", entityId: id,
        diff: { version, status: page.status, ...(page.title !== existing.title ? { title: page.title } : {}), ...(page.bodyHtml !== existing.bodyHtml ? { body: "changed" } : {}) },
      }))
      .commit();
    return { version, slug: page.slug };
  }
}

/** Command: delete. A legal text that was ever published is kept (consents reference its versions) — archive it. */
export class DeletePage extends PageCommand {
  async execute(id: string, actor: Actor): Promise<{ title: string }> {
    const page = await this.deps.pages.find(id);
    if (!page) throw ContentErrors.notFound();
    if (page.kind === "legal" && page.publishedAt) throw ContentErrors.publishedLegalCannotBeDeleted();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.pages.deleteStatement(id, page.version))
      .expectChanges(1, ContentErrors.changedMeanwhile)
      .add(this.deps.audit.recordStatement({ actor, action: "content.delete", entityType: "content_page", entityId: id, diff: { title: page.title, slug: page.slug } }))
      .commit();
    return { title: page.title };
  }
}

/** Query: admin list. */
export class ListPages {
  constructor(private readonly pages: ContentRepository) {}
  execute(): Promise<PageSummary[]> {
    return this.pages.list();
  }
}

/** Query: one page for the editor, with its version history. */
export class GetPage {
  constructor(private readonly pages: ContentRepository) {}
  async execute(id: string): Promise<(PageDetail & { revisions: PageRevision[] }) | null> {
    const page = await this.pages.find(id);
    return page ? { ...page, revisions: await this.pages.revisions(id) } : null;
  }
}

/** Query: the stored text of one earlier version. */
export class GetPageRevision {
  constructor(private readonly pages: ContentRepository) {}
  execute(pageId: string, version: number) {
    return this.pages.revision(pageId, version);
  }
}

const updatedFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });

/** Query: a published page for the storefront — placeholders filled from site settings, HTML sanitized. */
export class GetPublishedPage {
  constructor(private readonly pages: ContentRepository, private readonly vars: TemplateVariableSource) {}

  async execute(slug: string): Promise<PublishedPage | null> {
    const row = await this.pages.findPublished(slug);
    if (!row) return null;
    const vars = { ...(await this.vars.execute()), "sayfa.guncelleme": updatedFmt.format(new Date(row.updatedAt)) };
    // Stored HTML is sanitized on save; sanitizing again after filling placeholders keeps the output safe even
    // for rows written outside the admin (seed, SQL console).
    const html = sanitizeRichHtml(renderTemplate(sanitizeRichHtml(row.bodyHtml), vars).html);
    return { slug: row.slug, title: row.title, summary: row.summary, html, legalType: row.legalType, version: row.version, updatedAt: row.updatedAt, seo: row.seo };
  }
}

/** Query: footer columns built from published pages that chose a footer column. */
export class GetFooterLinks {
  constructor(private readonly pages: ContentRepository) {}

  async execute(): Promise<FooterLinkColumn[]> {
    const rows = await this.pages.footerLinks();
    return (Object.keys(FOOTER_COLUMNS) as (keyof typeof FOOTER_COLUMNS)[])
      .map((column) => ({ column, label: FOOTER_COLUMNS[column], links: rows.filter((r) => r.column === column).map((r) => ({ title: r.title, href: pageHref(r.slug) })) }))
      .filter((c) => c.links.length > 0);
  }
}

/** Query: the documents the checkout consent checkbox links to, and the version string recorded with the order. */
export class GetCheckoutLegal {
  constructor(private readonly pages: ContentRepository) {}

  async execute(): Promise<CheckoutLegal> {
    const rows = await this.pages.publishedLegal(["distance_sales", "pre_information"]);
    const pick = (t: "distance_sales" | "pre_information") => {
      const r = rows.find((x) => x.legalType === t);
      return r ? { href: pageHref(r.slug), title: r.title, version: r.version } : null;
    };
    const distanceSales = pick("distance_sales");
    const preInformation = pick("pre_information");
    return { distanceSales, preInformation, termsVersion: `ms${distanceSales?.version ?? 0}-ob${preInformation?.version ?? 0}` };
  }
}

/**
 * Query: the distance-sales contract and pre-information form exactly as accepted at checkout (`termsVersion`
 * "ms<v>-ob<v>", stored on the order), placeholders filled — the copy the order e-mail sends to the customer.
 */
export class GetAcceptedContracts {
  constructor(private readonly pages: ContentRepository, private readonly vars: TemplateVariableSource) {}

  async execute(termsVersion: string | null): Promise<{ title: string; html: string }[]> {
    const m = /^ms(\d+)-ob(\d+)$/.exec(termsVersion ?? "");
    const wanted: [LegalType, number][] = [["distance_sales", Number(m?.[1] ?? 0)], ["pre_information", Number(m?.[2] ?? 0)]];
    const vars = await this.vars.execute();
    const out: { title: string; html: string }[] = [];
    for (const [type, version] of wanted) {
      const row = await this.pages.legalAtVersion(type, version);
      if (!row) continue;
      const html = sanitizeRichHtml(renderTemplate(sanitizeRichHtml(row.bodyHtml), { ...vars, "sayfa.guncelleme": updatedFmt.format(new Date(row.updatedAt)) }).html);
      out.push({ title: row.title, html });
    }
    return out;
  }
}

/** Query: KVKK notice, membership agreement and privacy policy for the sign-up form (published only). */
export class GetSignupLegal {
  constructor(private readonly pages: ContentRepository) {}

  async execute(): Promise<SignupLegal> {
    const rows = await this.pages.publishedLegal(["kvkk", "membership", "privacy"]);
    const pick = (t: "kvkk" | "membership" | "privacy") => {
      const r = rows.find((x) => x.legalType === t);
      return r ? { href: pageHref(r.slug), title: r.title, version: r.version } : null;
    };
    const kvkk = pick("kvkk");
    const membership = pick("membership");
    const privacy = pick("privacy");
    return { kvkk, membership, privacy: privacy && { href: privacy.href, title: privacy.title }, consentVersion: `kv${kvkk?.version ?? 0}-us${membership?.version ?? 0}` };
  }
}


/** Query: the published cookie policy (consent banner link; its version is part of the cookie consent revision). */
export class GetCookiePolicy {
  constructor(private readonly pages: ContentRepository) {}

  async execute(): Promise<{ href: string; title: string; version: number } | null> {
    const [r] = await this.pages.publishedLegal(["cookies"]);
    return r ? { href: pageHref(r.slug), title: r.title, version: r.version } : null;
  }
}
