import { reply } from "@/core";
import { ListCustomersToken, customerQuerySchema } from "@/modules/customers";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/customers — members with order totals; segment tabs (counts), search, allowlisted sort, paging. */
export const GET = route({
  auth: { audience: "admin", permission: "customers.read" },
  query: customerQuerySchema,
  handle: async ({ query, resolve }) => {
    const r = await resolve(ListCustomersToken).execute(query);
    return reply.ok(r.rows, { total: r.total, page: query.page, pageSize: query.pageSize, segmentCounts: r.segmentCounts });
  },
});
