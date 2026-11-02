import { reply } from "@/core";
import { ConfirmCheckoutToken, confirmSchema } from "@/modules/checkout";
import { clientIp } from "@/modules/platform/module";
import { route } from "@/server/app";
import { startCheckoutForm } from "@/server/services/iyzico";

export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/confirm  (header: Idempotency-Key)
 * Body: { checkoutId, paymentMethod, email, phone, shipping, billing?, note?, acceptedTermsVersion }
 * Guest checkout is allowed (no account required).
 */
export const POST = route({
  auth: { audience: "storefront" },
  body: confirmSchema,
  idempotency: { scope: () => "checkout.confirm" },
  handle: async ({ body, req, resolve }) => {
    const order = await resolve(ConfirmCheckoutToken).execute(body);
    let payment: { paymentPageUrl: string | null } | null = null;
    if (order.paymentMethod === "iyzico") {
      // Network call happens AFTER the order transaction committed.
      const started = await startCheckoutForm(order.paymentId, clientIp(req));
      payment = { paymentPageUrl: started.paymentPageUrl };
    }
    return reply.created({ orderNumber: order.orderNumber, totalMinor: order.totalMinor, paymentMethod: order.paymentMethod, payment });
  },
});
