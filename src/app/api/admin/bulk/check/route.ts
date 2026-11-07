import { BULK_ROWS_BODY_LIMIT, CheckBulkRowsToken, bulkCheckSchema } from "@/modules/bulk";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/bulk/check — step 1 of an Excel import: what each row would do, nothing is written.
 * The file never reaches the server: the browser reads it and sends bounded cell texts only.
 */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: bulkCheckSchema,
  bodyLimit: BULK_ROWS_BODY_LIMIT,
  handle: (ctx) => ctx.resolve(CheckBulkRowsToken).execute(ctx.body, { ...actorOf(ctx), canPublish: ctx.user!.permissions.has("catalog.publish") }),
});
