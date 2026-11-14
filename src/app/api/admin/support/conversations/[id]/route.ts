import { GetStaffConversationToken, supportMessagesQuerySchema } from "@/modules/support";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — conversation + last page of messages; `?before=seq` older page, `?after=seq` resync. */
export const GET = route({
  auth: { audience: "admin", permission: "support.chat" },
  params: idParams,
  query: supportMessagesQuerySchema,
  handle: (ctx) => ctx.resolve(GetStaffConversationToken).execute(ctx.params.id, ctx.query),
});
