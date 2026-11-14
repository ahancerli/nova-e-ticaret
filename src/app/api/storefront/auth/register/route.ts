import { reply } from "@/core";
import { RegisterCustomerToken, signupSchema } from "@/modules/customers";
import { LoginToken } from "@/modules/identity";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/storefront/auth/register — member sign-up, then signed in (guest cart merges via the login listener). */
export const POST = route({
  body: signupSchema,
  captcha: "signup",
  cacheControl: "no-store",
  handle: async ({ body, req, resolve, requestId }) => {
    // kvkkAccepted is enforced by the schema (literal true); its record is the kvkk_notice consent.
    const { userId } = await resolve(RegisterCustomerToken).execute(body, req, requestId);
    await resolve(LoginToken).execute({ email: body.email, password: body.password, audience: "storefront", req });
    return reply.created({ userId });
  },
});
