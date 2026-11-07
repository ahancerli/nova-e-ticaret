import { ApplyBulkRowsToken, BULK_ROWS_BODY_LIMIT, bulkApplySchema } from "@/modules/bulk";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/admin/bulk/apply — step 2: write one chunk; the first chunk opens the job, `final` closes it. */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: bulkApplySchema,
  bodyLimit: BULK_ROWS_BODY_LIMIT,
  handle: (ctx) => ctx.resolve(ApplyBulkRowsToken).execute(ctx.body, { ...actorOf(ctx), canPublish: ctx.user!.permissions.has("catalog.publish") }),
});
