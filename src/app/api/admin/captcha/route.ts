import { GetCaptchaSettingsToken, SaveCaptchaSettingsToken, captchaSettingsSchema } from "@/modules/captcha";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/captcha — bot protection settings (`null` when none); the secret key is never returned. */
export const GET = route({
  auth: { audience: "admin", permission: "settings.write" },
  handle: ({ resolve }) => resolve(GetCaptchaSettingsToken).execute(),
});

/**
 * PUT — save the settings. Empty `secretKey` keeps the stored one; switching protection on (or changing keys while on)
 * needs `verificationToken` from the panel widget. `expectedUpdatedAt` guards concurrent edits (409).
 */
export const PUT = route({
  auth: { audience: "admin", permission: "settings.write" },
  body: captchaSettingsSchema,
  rateLimit: { name: "captcha-settings", limit: 20, windowSec: 10 * 60 },
  handle: (ctx) => ctx.resolve(SaveCaptchaSettingsToken).execute(ctx.body, actorOf(ctx)),
});
