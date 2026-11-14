import { MarkStaffReadToken, supportReadSchema } from "@/modules/support";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — staff saw the conversation up to `seq` (unread counter → badges of every agent). */
export const POST = route({
  auth: { audience: "admin", permission: "support.chat" },
  params: idParams,
  body: supportReadSchema,
  handle: (ctx) => ctx.resolve(MarkStaffReadToken).execute(ctx.params.id, ctx.body.seq),
});
