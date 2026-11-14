import { GetInvoicePdfToken } from "@/modules/invoices";
import { currentPrincipal, resolveService } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * GET — the invoice PDF for staff (opened in a new tab). A file stream, not a JSON route: the session and the
 * `orders.read` permission are checked here; the file never sits under the public /assets route.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentPrincipal("admin");
  if (!user?.isStaff || !user.permissions.has("orders.read")) return new Response("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Not found", { status: 404 });
  const r = await (await resolveService(GetInvoicePdfToken)).forStaff(id);
  if (!r) return new Response("Not found", { status: 404 });
  return new Response(r.file.body, {
    headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${r.fileName}"`, "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
