import { RateLimiterToken } from "@/core";
import { SubscribeNewsletterToken, newsletterSubscribeSchema } from "@/modules/newsletter";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/newsletter `{ email, consent: true }` — footer sign-up. Always the same answer (no address probing);
 * the confirmation e-mail completes the subscription.
 */
export const POST = route({
  auth: { audience: "storefront" },
  body: newsletterSubscribeSchema,
  rateLimit: { name: "newsletter", limit: 5, windowSec: 60 * 60 },
  captcha: "newsletter",
  handle: async ({ body, req, resolve }) =>
    resolve(SubscribeNewsletterToken).execute({ email: body.email, source: "footer" }, { ipHash: await resolve(RateLimiterToken).clientKey(req) }),
});
