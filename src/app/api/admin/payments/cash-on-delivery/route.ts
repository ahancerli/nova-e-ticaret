import { SetCashOnDeliveryToken, cashOnDeliverySchema } from "@/modules/payments";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT /api/admin/payments/cash-on-delivery — Kapıda ödeme on/off, fee, order limits, allowed categories. */
export const PUT = route({
  auth: { audience: "admin", permission: "payments.secrets" },
  body: cashOnDeliverySchema,
  handle: (ctx) => {
    const { expectedUpdatedAt, ...settings } = ctx.body;
    return ctx.resolve(SetCashOnDeliveryToken).execute({ ...settings, expectedUpdatedAt }, actorOf(ctx));
  },
});
