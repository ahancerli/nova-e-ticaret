import { RunStaffActionToken, staffActionSchema } from "@/modules/staff";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST { action } — suspend · reactivate · resend_invite · password_reset · revoke_sessions · cancel_invite. */
export const POST = route({
  auth: { audience: "admin", permission: "users.manage" },
  params: idParams,
  body: staffActionSchema,
  cacheControl: "no-store",
  handle: (ctx) => ctx.resolve(RunStaffActionToken).execute(ctx.params.id, ctx.body.action, actorOf(ctx)),
});
