import { cookies } from "next/headers";
import {
  ClearRecentlyViewedToken, ListRecentlyViewedToken, RECENT_COOKIE, RECENT_COOKIE_DAYS, RecordRecentViewToken, isVisitorCookie, recentListQuery, recentViewSchema,
  type Viewer,
} from "@/modules/recently-viewed";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** Members are known by their session; guests by a random HttpOnly cookie that is only set once something is kept. */
async function viewer(req: Request, userId: string | null, mint = false): Promise<{ viewer: Viewer; minted: string | null }> {
  const current = (await cookies()).get(RECENT_COOKIE)?.value;
  const minted = !userId && !isVisitorCookie(current) && mint ? crypto.randomUUID() : null;
  return { viewer: { userId, visitorId: minted ?? (isVisitorCookie(current) ? current : null), cookieHeader: req.headers.get("cookie") }, minted };
}

/** GET `?exclude=&limit=` — Son gezilenler cards (empty without functional cookie consent). */
export const GET = route({
  auth: { audience: "storefront" },
  query: recentListQuery,
  handle: async (ctx) => ctx.resolve(ListRecentlyViewedToken).execute((await viewer(ctx.req, ctx.user?.id ?? null)).viewer, { excludeId: ctx.query.exclude, limit: ctx.query.limit }),
});

/** POST `{ productId }` — remember a product page view; answers the list without that product. */
export const POST = route({
  auth: { audience: "storefront" },
  body: recentViewSchema,
  rateLimit: { name: "recent-view", limit: 600, windowSec: 60 * 60 },
  handle: async (ctx) => {
    const v = await viewer(ctx.req, ctx.user?.id ?? null, true);
    const r = await ctx.resolve(RecordRecentViewToken).execute(v.viewer, ctx.body.productId);
    if (r.recorded && v.minted) {
      (await cookies()).set(RECENT_COOKIE, v.minted, {
        httpOnly: true, sameSite: "lax", secure: new URL(ctx.req.url).protocol === "https:", path: "/", maxAge: RECENT_COOKIE_DAYS * 86_400,
      });
    }
    return r.items;
  },
});

/** DELETE — "Geçmişi temizle": forget the list and the guest cookie. */
export const DELETE = route({
  auth: { audience: "storefront" },
  handle: async (ctx) => {
    const r = await ctx.resolve(ClearRecentlyViewedToken).execute((await viewer(ctx.req, ctx.user?.id ?? null)).viewer);
    (await cookies()).delete(RECENT_COOKIE);
    return r;
  },
});
