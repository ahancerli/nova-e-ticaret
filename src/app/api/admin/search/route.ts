import { GetSearchAdminToken } from "@/modules/search";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/search — engine status, index sync state, synonyms, popular and zero-result searches. */
export const GET = route({
  auth: { audience: "admin", permission: "catalog.write" },
  handle: ({ resolve }) => resolve(GetSearchAdminToken).execute(),
});
