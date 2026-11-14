import { ListReturnsToken, returnListSchema, type ReturnStatus } from "@/modules/returns";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET ?status=requested|approved|received|refunded|rejected|cancelled|all — rows + per-status counts. */
export const GET = route({
  auth: { audience: "admin", permission: "orders.read" },
  query: returnListSchema,
  handle: (ctx) => ctx.resolve(ListReturnsToken).execute(ctx.query.status as ReturnStatus | "all"),
});
