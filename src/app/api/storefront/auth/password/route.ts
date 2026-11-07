import { ChangePasswordToken, LoginToken, changePasswordSchema } from "@/modules/identity";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/storefront/auth/password — signed-in customer changes the password. All sessions end (also on other
 * devices); this browser is signed in again with the new password. Rate limited against password guessing.
 */
export const POST = route({
  auth: { audience: "storefront", required: true },
  body: changePasswordSchema,
  rateLimit: { name: "password-change", limit: 10, windowSec: 15 * 60 },
  cacheControl: "no-store",
  handle: async ({ body, user, req, resolve }) => {
    await resolve(ChangePasswordToken).execute(user!, body.currentPassword, body.newPassword);
    await resolve(LoginToken).execute({ email: user!.email, password: body.newPassword, audience: "storefront", req });
    return { changed: true };
  },
});
