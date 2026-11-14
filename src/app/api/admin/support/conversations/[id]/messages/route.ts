import { reply } from "@/core";
import { SendStaffMessageToken, supportStaffMessageSchema } from "@/modules/support";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — answer the customer (the first answer assigns the conversation). */
export const POST = route({
  auth: { audience: "admin", permission: "support.chat" },
  params: idParams,
  body: supportStaffMessageSchema,
  bodyLimit: 8_192,
  handle: async (ctx) => reply.created(await ctx.resolve(SendStaffMessageToken).execute(ctx.params.id, ctx.body, actorOf(ctx))),
});
