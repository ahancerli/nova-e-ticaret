import { reply } from "@/core";
import { FinishSocialSignupToken, socialSignupSchema } from "@/modules/social-login";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/storefront/auth/social/signup — "üyeliği tamamla": creates the member from the signed draft cookie the
 * callback left (provider identity + verified e-mail), records the consents and signs in. No CAPTCHA: the draft only
 * exists after a completed provider sign-in; the per-IP sign-up limit still applies.
 */
export const POST = route({
  body: socialSignupSchema,
  cacheControl: "no-store",
  handle: async ({ body, req, resolve, requestId }) => reply.created(await resolve(FinishSocialSignupToken).execute(body, req, requestId)),
});
