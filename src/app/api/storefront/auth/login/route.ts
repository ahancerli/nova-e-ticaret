import { LoginToken, loginSchema } from "@/modules/identity";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** Storefront login. A successful login merges the guest cart (identity login listener, see src/server/app.ts). */
export const POST = route({
  body: loginSchema,
  captcha: "login",
  handle: async ({ body, req, resolve }) => {
    await resolve(LoginToken).execute({ ...body, audience: "storefront", req });
    return { loggedIn: true, audience: "storefront" };
  },
});
