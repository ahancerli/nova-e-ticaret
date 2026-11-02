import { RunCustomerActionToken, customerActionSchema } from "@/modules/customers";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST { action } — suspend · reactivate · password_reset (one-time link) · revoke_sessions. */
export const POST = route({
  auth: { audience: "admin", permission: ["customers.read", "customers.write"] },
  params: idParams,
  body: customerActionSchema,
  cacheControl: "no-store",
  handle: (ctx) => ctx.resolve(RunCustomerActionToken).execute(ctx.params.id, ctx.body.action, actorOf(ctx)),
});
