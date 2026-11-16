import { RateLimiterToken } from "@/core";
import { CompleteSocialLoginToken, socialCallbackQuery, socialProviderParams } from "@/modules/social-login";
import { route } from "@/server/app";
import { redirectTo, redirectToLoginError } from "../../redirects";

export const dynamic = "force-dynamic";

/**
 * GET /api/storefront/auth/social/<provider>/callback — the address registered at the provider. Signs the member in
 * (guest cart merges via the login listener) and lands on the path chosen at start, sends a new person to
 * "üyeliği tamamla", or returns to /giris?hata=<code>.
 */
export const GET = route({
  params: socialProviderParams,
  query: socialCallbackQuery,
  cacheControl: "no-store",
  handle: async ({ params, query, req, resolve, requestId, logger }) => {
    try {
      const limiter = resolve(RateLimiterToken);
      await limiter.hit(`social-callback:${await limiter.clientKey(req)}`, 20, 10 * 60);
      const { redirectTo: target } = await resolve(CompleteSocialLoginToken).execute(params.provider, query, req, requestId);
      return redirectTo(target);
    } catch (err) {
      return redirectToLoginError(err, logger, params.provider);
    }
  },
});
