import { TestChannelToken, socialChannelParams } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — "Bağlantıyı test et": reads the account with the stored token and renews the webhook subscription. */
export const POST = route({
  auth: { audience: "admin", permission: "social_ai.manage" },
  params: socialChannelParams,
  rateLimit: { name: "social-ai-test", limit: 10, windowSec: 60 },
  handle: (ctx) => ctx.resolve(TestChannelToken).execute(ctx.params.channel),
});
