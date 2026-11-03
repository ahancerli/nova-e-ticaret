import { reply } from "@/core";
import { ListAuditLogsToken, auditQuerySchema } from "@/modules/audit";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/audit — audit entries; area tabs (counts), actor / record type / record / day range filters, search, paging. */
export const GET = route({
  auth: { audience: "admin", permission: "audit.read" },
  query: auditQuerySchema,
  handle: async ({ query, resolve }) => {
    const r = await resolve(ListAuditLogsToken).execute(query);
    return reply.ok(r.rows, { total: r.total, page: query.page, pageSize: query.pageSize, areaCounts: r.areaCounts });
  },
});
