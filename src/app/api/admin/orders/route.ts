import { reply } from "@/core";
import { ListOrdersToken, orderQuerySchema } from "@/modules/orders";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/orders — server-side search, filters, status tabs (counts), allowlisted sort, pagination. */
export const GET = route({
  auth: { audience: "admin", permission: "orders.read" },
  query: orderQuerySchema,
  handle: async ({ query, user, resolve }) => {
    const result = await resolve(ListOrdersToken).execute(query, user!.permissions.has("customers.read"));
    return reply.ok(result.items, { total: result.total, page: result.page, pageSize: result.pageSize, kpi: result.kpi, statusCounts: result.statusCounts });
  },
});
