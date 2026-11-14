import { SignalStaffTypingToken } from "@/modules/support";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — "yazıyor…" signal to the customer (not stored). */
export const POST = route({
  auth: { audience: "admin", permission: "support.chat" },
  rateLimit: { name: "support-typing-admin", limit: 60, windowSec: 60 },
  params: idParams,
  handle: (ctx) => ctx.resolve(SignalStaffTypingToken).execute(ctx.params.id),
});
