import { SaveIyzicoKeysToken, iyzicoKeysSchema } from "@/modules/payments";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT /api/admin/payments/iyzico — store one environment's keys; an empty key keeps the stored one. 409 on concurrent edits. */
export const PUT = route({
  auth: { audience: "admin", permission: "payments.secrets" },
  body: iyzicoKeysSchema,
  handle: (ctx) => ctx.resolve(SaveIyzicoKeysToken).execute(ctx.body, actorOf(ctx)),
});
