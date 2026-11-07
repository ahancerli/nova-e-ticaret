import { reply } from "@/core";
import { ListReviewsToken, adminReviewQuerySchema } from "@/modules/reviews";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/reviews — moderation list: status tab, star filter, search, allowlisted sort, paging; meta = tab counts + average. */
export const GET = route({
  auth: { audience: "admin", permission: "reviews.moderate" },
  query: adminReviewQuerySchema,
  handle: async ({ query, resolve }) => {
    const r = await resolve(ListReviewsToken).execute(query);
    return reply.ok(r.rows, { total: r.total, page: query.page, pageSize: query.pageSize, stats: r.stats });
  },
});
