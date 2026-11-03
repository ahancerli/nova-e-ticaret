import { NotFoundError } from "@/core";
import { GetAuditLogToken } from "@/modules/audit";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/audit/:id — one entry with its redacted change set, same-request entries and the record's history. */
export const GET = route({
  auth: { audience: "admin", permission: "audit.read" },
  params: idParams,
  handle: async ({ params, resolve }) => {
    const entry = await resolve(GetAuditLogToken).execute(params.id);
    if (!entry) throw new NotFoundError("audit_entry_not_found", "Denetim kaydı bulunamadı.");
    return entry;
  },
});
