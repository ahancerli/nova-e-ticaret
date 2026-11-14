import { BadRequestError, PayloadTooLargeError, ValidationError, reply } from "@/core";
import { MAX_INVOICE_PDF_BYTES, RecordInvoiceToken, invoiceRecordSchema } from "@/modules/invoices";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

const MULTIPART_OVERHEAD = 64 * 1024;

/** POST multipart (kind, invoiceNumber, invoiceDate, ettn?, file?) — attach the invoice issued at the accounting provider. */
export const POST = route({
  auth: { audience: "admin", permission: "orders.write" },
  params: idParams,
  csrf: "multipart",
  handle: async (ctx) => {
    const length = ctx.req.headers.get("content-length");
    if (!length) throw new BadRequestError("length_required", "Yükleme boyutu bildirilmedi.");
    if (Number(length) > MAX_INVOICE_PDF_BYTES + MULTIPART_OVERHEAD) throw new PayloadTooLargeError("file_too_large", "PDF en fazla 5 MB olabilir.", { fieldErrors: { file: ["PDF en fazla 5 MB olabilir."] } });
    const form = await ctx.req.formData().catch(() => { throw new BadRequestError("invalid_form", "Form verisi okunamadı."); });
    const parsed = invoiceRecordSchema.safeParse({
      kind: form.get("kind") ?? undefined, invoiceNumber: form.get("invoiceNumber") ?? "", invoiceDate: form.get("invoiceDate") ?? "", ettn: form.get("ettn") ?? undefined,
    });
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (fieldErrors[i.path.join(".")] ??= []).push(i.message);
      throw new ValidationError("validation_error", "Fatura bilgilerini kontrol edin.", { fieldErrors });
    }
    const file = form.get("file");
    const pdf = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
    return reply.created(await ctx.resolve(RecordInvoiceToken).execute(ctx.params.id, parsed.data, pdf, actorOf(ctx)));
  },
});
