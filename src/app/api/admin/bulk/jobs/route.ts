import { reply } from "@/core";
import { ListBulkJobsToken } from "@/modules/bulk";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/bulk/jobs — recent imports and feed runs (history tab). */
export const GET = route({
  auth: { audience: "admin", permission: "catalog.write" },
  handle: async ({ resolve }) => {
    const rows = await resolve(ListBulkJobsToken).execute();
    return reply.ok(rows, { total: rows.length });
  },
});
