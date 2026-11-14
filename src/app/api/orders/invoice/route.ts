import { NotFoundError } from "@/core";
import { GetInvoicePdfToken } from "@/modules/invoices";
import { returnOptionsSchema } from "@/modules/returns";
import { route } from "@/server/app";
import { returnIdentity } from "../../returns/identity";

export const dynamic = "force-dynamic";

/**
 * POST { orderNumber, email? } — the customer's invoice PDF (base64 in the JSON envelope, ≤ 5 MB): a member's own
 * order, or a guest order proven by its e-mail. Same answer for "no invoice" and "not your order".
 */
export const POST = route({
  auth: { audience: "storefront" },
  body: returnOptionsSchema,
  rateLimit: { name: "invoice_download", limit: 20, windowSec: 900 },
  handle: async (ctx) => {
    const r = await ctx.resolve(GetInvoicePdfToken).forCustomer(ctx.body.orderNumber, returnIdentity(ctx.user, ctx.body.email));
    if (!r) throw new NotFoundError("invoice_not_found", "Bu sipariş için henüz fatura yok.");
    const bytes = new Uint8Array(await new Response(r.file.body).arrayBuffer());
    return { fileName: r.fileName, contentType: "application/pdf", base64: Buffer.from(bytes).toString("base64") };
  },
});
