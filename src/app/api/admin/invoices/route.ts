import { ListInvoicesToken, invoiceListSchema } from "@/modules/invoices";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET ?tab=pending|issued|cancelled — orders waiting for an invoice, or invoices. */
export const GET = route({
  auth: { audience: "admin", permission: "orders.read" },
  query: invoiceListSchema,
  handle: (ctx) => ctx.resolve(ListInvoicesToken).execute(ctx.query.tab),
});
