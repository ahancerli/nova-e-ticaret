import { LoginToken, loginSchema } from "@/modules/identity";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const POST = route({
  body: loginSchema,
  handle: async ({ body, req, resolve }) => {
    await resolve(LoginToken).execute({ ...body, audience: "admin", req });
    return { loggedIn: true, audience: "admin" };
  },
});
