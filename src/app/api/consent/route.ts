import { RateLimiterToken, reply } from "@/core";
import { RecordConsentToken, consentRecordSchema } from "@/modules/consent";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/consent — proof row for a cookie choice the browser already applied (features/consent). Public (visitors
 * decide before logging in); a signed-in customer is linked. The IP is stored only as the rate limiter's HMAC.
 */
export const POST = route({
  auth: { audience: "storefront" },
  body: consentRecordSchema,
  bodyLimit: 2 * 1024,
  rateLimit: { name: "consent", limit: 20, windowSec: 60 },
  handle: async ({ body, user, req, resolve }) => {
    const ipHash = await resolve(RateLimiterToken).clientKey(req);
    return reply.created(await resolve(RecordConsentToken).execute(body, { userId: user?.id ?? null, ipHash, userAgent: req.headers.get("user-agent") }));
  },
});
