import { sha256Hex, type Clock, type Database } from "@/core";
import type { ProductCard } from "@/lib/types";
import { RECENT_KEEP, RECENT_RETENTION_DAYS, RECENT_SHOW, isVisitorCookie, type Viewer } from "../domain/recently-viewed";
import type { FunctionalConsent, RecentCards, RecentViewRepository } from "./ports";

export interface RecentDeps {
  db: Database;
  views: RecentViewRepository;
  cards: RecentCards;
  consent: FunctionalConsent;
  clock: Clock;
}

/** Hash of the viewer's key, or null when nothing may be kept (no functional consent / no id). */
async function viewerKey(deps: RecentDeps, v: Viewer): Promise<string | null> {
  const key = v.userId ? `u:${v.userId}` : isVisitorCookie(v.visitorId) ? `v:${v.visitorId}` : null;
  if (!key || !(await deps.consent.execute(v.cookieHeader))) return null;
  return sha256Hex(`recent:${key}`);
}

const since = (clock: Clock) => new Date(clock.now().getTime() - RECENT_RETENTION_DAYS * 86_400_000).toISOString();

async function cardsOf(deps: RecentDeps, hash: string, excludeId: string | null, limit: number): Promise<ProductCard[]> {
  // all kept ids: some may be unpublished by now and drop out of the cards
  const ids = (await deps.views.productIds(hash, since(deps.clock), RECENT_KEEP)).filter((id) => id !== excludeId);
  return ids.length ? (await deps.cards.execute(ids)).slice(0, Math.min(limit, RECENT_SHOW)) : [];
}

/** Query: cards of the viewer's recently viewed products still on sale, most recent first. */
export class ListRecentlyViewed {
  constructor(private readonly deps: RecentDeps) {}

  async execute(viewer: Viewer, opts: { excludeId?: string | null; limit?: number } = {}): Promise<ProductCard[]> {
    const hash = await viewerKey(this.deps, viewer);
    return hash ? cardsOf(this.deps, hash, opts.excludeId ?? null, opts.limit ?? RECENT_SHOW) : [];
  }
}

/**
 * Command (product page, after it rendered): remember the view and answer the list without the current product —
 * one request. `recorded: false` = not kept (no consent / unknown product), the page shows no list then.
 */
export class RecordRecentView {
  constructor(private readonly deps: RecentDeps) {}

  async execute(viewer: Viewer, productId: string): Promise<{ recorded: boolean; items: ProductCard[] }> {
    const hash = await viewerKey(this.deps, viewer);
    if (!hash || !(await this.deps.views.isPublished(productId))) return { recorded: false, items: [] };
    await this.deps.db.batch(this.deps.views.recordStatements(hash, productId, this.deps.clock.nowIso(), RECENT_KEEP, since(this.deps.clock)));
    return { recorded: true, items: await cardsOf(this.deps, hash, productId, RECENT_SHOW) };
  }
}

/** Command: "Geçmişi temizle" — always allowed (also after consent was withdrawn). */
export class ClearRecentlyViewed {
  constructor(private readonly deps: RecentDeps) {}

  async execute(viewer: Viewer): Promise<{ cleared: true }> {
    const key = viewer.userId ? `u:${viewer.userId}` : isVisitorCookie(viewer.visitorId) ? `v:${viewer.visitorId}` : null;
    if (key) await this.deps.db.batch([this.deps.views.clearStatement(await sha256Hex(`recent:${key}`))]);
    return { cleared: true };
  }
}
