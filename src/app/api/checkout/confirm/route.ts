import { reply } from "@/core";
import { ConfirmCheckoutToken, confirmSchema } from "@/modules/checkout";
import { CaptureOrderTrackingToken } from "@/modules/consent";
import { clientIp } from "@/modules/platform/module";
import { StartCardPaymentToken } from "@/modules/payments";
import { route } from "@/server/app";

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
  handle: async ({ body, req, resolve, logger }) => {
    const order = await resolve(ConfirmCheckoutToken).execute(body);
    // consent + vendor cookies for the server-side purchase (sent on order.paid); never fails the order
    await resolve(CaptureOrderTrackingToken).execute({
      orderId: order.orderId, cookieHeader: req.headers.get("cookie"), clientIp: clientIp(req), userAgent: req.headers.get("user-agent"), referer: req.headers.get("referer"),
    }).catch((err: unknown) => logger.warn("order tracking context not saved", { orderId: order.orderId, error: String(err) }));
    let payment: { paymentPageUrl: string | null } | null = null;
    if (order.paymentMethod === "iyzico") {
      // Network call happens AFTER the order transaction committed.
      const started = await resolve(StartCardPaymentToken).execute(order.paymentId, clientIp(req));
      payment = { paymentPageUrl: started.paymentPageUrl };
    }
    return reply.created({ orderNumber: order.orderNumber, totalMinor: order.totalMinor, paymentMethod: order.paymentMethod, payment });
  },
});
