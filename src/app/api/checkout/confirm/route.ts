import { handler, ok, readJson } from "@/server/http";
import { withIdempotency } from "@/server/idempotency";
import { assertSameOrigin, clientIp } from "@/server/security";
import { confirmCheckout } from "@/server/services/checkout";
import { startCheckoutForm } from "@/server/services/iyzico";
import { confirmSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/confirm  (header: Idempotency-Key)
 * Body: { checkoutId, paymentMethod, email, phone, shipping, billing?, note?, acceptedTermsVersion }
 * Guest checkout is allowed (no account required).
 */
export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const input = confirmSchema.parse(await readJson(req));
  const result = await withIdempotency(req, "checkout.confirm", input, async () => {
    const order = await confirmCheckout(input);
    let payment: { paymentPageUrl: string | null } | null = null;
    if (order.paymentMethod === "iyzico") {
      // Network call happens AFTER the DB batch committed.
      const started = await startCheckoutForm(order.paymentId, clientIp(req));
      payment = { paymentPageUrl: started.paymentPageUrl };
    }
    return { status: 201, data: { orderNumber: order.orderNumber, totalMinor: order.totalMinor, paymentMethod: order.paymentMethod, payment } };
  });
  return ok(req, result.data, { replayed: result.replayed }, result.status);
});
