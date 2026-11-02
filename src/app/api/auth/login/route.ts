import { LoginToken, loginSchema } from "@/modules/identity";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** Backward-compatible storefront login endpoint. Prefer /api/storefront/auth/login for new calls. */
export const POST = route({
  body: loginSchema,
  handle: async ({ body, req, resolve }) => {
    await resolve(LoginToken).execute({ ...body, audience: "storefront", req, ipBucket: "login-fail" });
    return { loggedIn: true };
  },
});
