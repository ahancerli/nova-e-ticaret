import { SetSupportStatusToken, supportStatusSchema } from "@/modules/support";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — close or reopen a conversation. */
export const POST = route({
  auth: { audience: "admin", permission: "support.chat" },
  params: idParams,
  body: supportStatusSchema,
  handle: (ctx) => ctx.resolve(SetSupportStatusToken).execute(ctx.params.id, ctx.body.status, actorOf(ctx)),
});
