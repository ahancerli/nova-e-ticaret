import { NotFoundError } from "@/core";
import { GetPageRevisionToken, revisionParams } from "@/modules/content";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/content/:id/revisions/:version — the stored text of an earlier version. */
export const GET = route({
  auth: { audience: "admin", permission: "content.write" },
  params: revisionParams,
  handle: async ({ params, resolve }) => {
    const rev = await resolve(GetPageRevisionToken).execute(params.id, params.version);
    if (!rev) throw new NotFoundError("revision_not_found", "Bu sürüm bulunamadı.");
    return rev;
  },
});
