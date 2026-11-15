import { reply } from "@/core";
import { ListSubscribersToken, subscriberQuerySchema } from "@/modules/newsletter";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/newsletter — E-bülten subscribers: status tabs (counts), search, allowlisted sort, paging. */
export const GET = route({
  auth: { audience: "admin", permission: "customers.read" },
  query: subscriberQuerySchema,
  handle: async ({ query, resolve }) => {
    const r = await resolve(ListSubscribersToken).execute(query);
    return reply.ok(r.rows, { total: r.total, page: query.page, pageSize: query.pageSize, counts: r.counts });
  },
});
