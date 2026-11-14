import { ListSupportInboxToken, supportInboxQuerySchema } from "@/modules/support";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — inbox: every open conversation, or the latest closed ones (`?status=closed`). */
export const GET = route({
  auth: { audience: "admin", permission: "support.chat" },
  query: supportInboxQuerySchema,
  handle: (ctx) => ctx.resolve(ListSupportInboxToken).execute(ctx.query.status),
});
