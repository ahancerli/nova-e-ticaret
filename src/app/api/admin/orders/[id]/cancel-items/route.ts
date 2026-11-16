import { ItemCancellationsToken, cancelItemsQuoteSchema } from "@/modules/orders";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/:id/cancel-items — preview only (nothing is written): what cancelling these units refunds,
 * the campaign / shipping difference and whether an invoice has to be corrected. The cancellation itself is the
 * `cancel_items` order action (…/actions, Idempotency-Key).
 */
export const POST = route({
  auth: { audience: "admin", permission: "orders.write" },
  params: idParams,
  body: cancelItemsQuoteSchema,
  handle: (ctx) => ctx.resolve(ItemCancellationsToken).quote(ctx.params.id, ctx.body, { source: "admin" }),
});
