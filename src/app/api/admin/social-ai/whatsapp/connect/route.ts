import { actorOf } from "@/modules/shared/actor";
import { ConnectWhatsAppToken, whatsappConnectSchema } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST — finish WhatsApp Embedded Signup: exchange the popup's code (valid 30 s), subscribe the WABA, store the token. */
export const POST = route({
  auth: { audience: "admin", permission: "social_ai.manage" },
  body: whatsappConnectSchema,
  rateLimit: { name: "social-ai-connect", limit: 10, windowSec: 60 },
  handle: (ctx) => ctx.resolve(ConnectWhatsAppToken).execute(ctx.body, actorOf(ctx)),
});
