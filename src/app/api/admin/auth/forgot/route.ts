import { after } from "next/server";
import { LoggerToken } from "@/core";
import { RequestPasswordResetToken, forgotPasswordSchema } from "@/modules/identity";
import { GetPublicSettingsToken } from "@/modules/settings";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/auth/forgot — "Parolamı unuttum" for panel accounts. Always the same answer; the lookup and the
 * SMTP delivery run after the response (`after`), so neither the reply nor its timing tells whether the address
 * belongs to a staff account. IP limit: 5 requests / 15 min.
 */
export const POST = route({
  body: forgotPasswordSchema,
  rateLimit: { name: "password-forgot", limit: 5, windowSec: 15 * 60 },
  handle: async ({ body, resolve }) => {
    const reset = resolve(RequestPasswordResetToken);
    const logger = resolve(LoggerToken);
    const brand = (await resolve(GetPublicSettingsToken).execute()).siteName;
    after(async () => {
      try {
        const outcome = await reset.execute(body.email, "staff", brand);
        logger.info("password reset request handled", { outcome });
      } catch (err) {
        logger.error("password reset e-mail failed", { error: String(err), code: (err as { code?: string }).code });
      }
    });
    return { requested: true };
  },
});
