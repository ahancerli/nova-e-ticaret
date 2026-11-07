import { after } from "next/server";
import { ConfigToken, LoggerToken } from "@/core";
import { RequestPasswordResetToken, forgotPasswordSchema } from "@/modules/identity";
import { GetPublicSettingsToken } from "@/modules/settings";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/storefront/auth/forgot — "Şifremi unuttum" for customers. Same answer for every address; the lookup and
 * the e-mail run after the response (`after`), so neither the reply nor its timing tells whether a customer account
 * exists. IP limit: 5 requests / 15 min. Outside production the request runs inline (logged) for local testing.
 */
export const POST = route({
  body: forgotPasswordSchema,
  rateLimit: { name: "password-forgot", limit: 5, windowSec: 15 * 60 },
  handle: async ({ body, resolve }) => {
    const reset = resolve(RequestPasswordResetToken);
    const logger = resolve(LoggerToken);
    const brand = (await resolve(GetPublicSettingsToken).execute()).siteName;
    const run = async () => {
      try {
        logger.info("customer password reset handled", { outcome: await reset.execute(body.email, "customer", brand) });
      } catch (err) {
        logger.error("customer password reset e-mail failed", { error: String(err), code: (err as { code?: string }).code });
      }
    };
    if (!resolve(ConfigToken).isProduction) await run();
    else after(run);
    return { requested: true };
  },
});
