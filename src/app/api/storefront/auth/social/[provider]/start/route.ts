import { RateLimiterToken } from "@/core";
import { safeInternalPath } from "@/lib/safe-redirect";
import { StartSocialLoginToken, socialProviderParams, socialStartQuery } from "@/modules/social-login";
import { route } from "@/server/app";
import { redirectTo, redirectToLoginError } from "../../redirects";

export const dynamic = "force-dynamic";

/**
 * GET /api/storefront/auth/social/<provider>/start?next=/sepet — target of the "… ile devam et" button: stores the
 * signed flow cookie (state, PKCE verifier, nonce, landing path) and sends the browser to the provider.
 */
export const GET = route({
  params: socialProviderParams,
  query: socialStartQuery,
  cacheControl: "no-store",
  handle: async ({ params, query, req, resolve, logger }) => {
    try {
      const limiter = resolve(RateLimiterToken);
      await limiter.hit(`social-start:${await limiter.clientKey(req)}`, 20, 10 * 60);
      const { authorizationUrl } = await resolve(StartSocialLoginToken).execute(params.provider, safeInternalPath(query.next, "/hesabim"));
      return redirectTo(authorizationUrl);
    } catch (err) {
      return redirectToLoginError(err, logger, params.provider);
    }
  },
});
