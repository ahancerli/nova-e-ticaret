import { actorOf } from "@/modules/shared/actor";
import { ConnectManuallyToken, manualConnectSchema, socialChannelParams } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — fallback / development: connect with ids and an access token typed in by hand (verified at Meta first). */
export const POST = route({
  auth: { audience: "admin", permission: "social_ai.manage" },
  params: socialChannelParams,
  body: manualConnectSchema,
  rateLimit: { name: "social-ai-connect", limit: 10, windowSec: 60 },
  handle: (ctx) => ctx.resolve(ConnectManuallyToken).execute(ctx.params.channel, ctx.body, actorOf(ctx)),
});
