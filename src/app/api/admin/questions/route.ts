import { reply } from "@/core";
import { ListQuestionsToken, adminQuestionQuerySchema } from "@/modules/questions";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/questions — Ürün soruları list: status tab, search, allowlisted sort, paging; meta = tab counts. */
export const GET = route({
  auth: { audience: "admin", permission: "reviews.moderate" },
  query: adminQuestionQuerySchema,
  handle: async ({ query, resolve }) => {
    const r = await resolve(ListQuestionsToken).execute(query);
    return reply.ok(r.rows, { total: r.total, page: query.page, pageSize: query.pageSize, counts: r.counts });
  },
});
