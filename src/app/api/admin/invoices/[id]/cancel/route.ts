import { CancelInvoiceToken, invoiceCancelSchema } from "@/modules/invoices";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const POST = route({
  auth: { audience: "admin", permission: "orders.write" },
  params: idParams,
  body: invoiceCancelSchema,
  handle: (ctx) => ctx.resolve(CancelInvoiceToken).execute(ctx.params.id, ctx.body.reason, actorOf(ctx)),
});
