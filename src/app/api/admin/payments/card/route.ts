import { SetCardPaymentsToken, cardPaymentsSchema } from "@/modules/payments";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT /api/admin/payments/card — `{ environment }` turns card payments on in that environment, `null` turns them off. */
export const PUT = route({
  auth: { audience: "admin", permission: "payments.secrets" },
  body: cardPaymentsSchema,
  handle: (ctx) => ctx.resolve(SetCardPaymentsToken).execute(ctx.body.environment, actorOf(ctx)),
});
