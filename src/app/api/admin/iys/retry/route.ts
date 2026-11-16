import { RetryIysFailedToken } from "@/modules/iys";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — put refused rows back into the queue (after fixing the cause). */
export const POST = route({
  auth: { audience: "admin", permission: "integrations.write" },
  handle: (ctx) => ctx.resolve(RetryIysFailedToken).execute(),
});
