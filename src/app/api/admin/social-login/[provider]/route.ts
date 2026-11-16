import { actorOf } from "@/modules/shared/actor";
import { SaveSocialProviderToken, socialProviderParams, socialProviderSchema } from "@/modules/social-login";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * PUT /api/admin/social-login/<provider> — save one provider's OAuth client. Empty `clientSecret` keeps the stored
 * one; changed keys (and switching on) are checked at the provider first. `expectedUpdatedAt` guards concurrent edits (409).
 */
export const PUT = route({
  auth: { audience: "admin", permission: "settings.write" },
  params: socialProviderParams,
  body: socialProviderSchema,
  rateLimit: { name: "social-login-settings", limit: 20, windowSec: 10 * 60 },
  handle: (ctx) => ctx.resolve(SaveSocialProviderToken).execute(ctx.params.provider, ctx.body, actorOf(ctx)),
});
