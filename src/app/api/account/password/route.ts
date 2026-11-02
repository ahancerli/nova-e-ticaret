import { CompleteAccountLinkToken, completeLinkSchema } from "@/modules/identity";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/account/password — { token, password }: the person sets their own password from an invitation or
 * reset link. Public (no session), same-origin only, rate-limited per IP; the token is single-use.
 */
export const POST = route({
  body: completeLinkSchema,
  rateLimit: { name: "account-link", limit: 10, windowSec: 15 * 60 },
  cacheControl: "no-store",
  handle: async ({ body, resolve, requestId }) => {
    const r = await resolve(CompleteAccountLinkToken).execute(body.token, body.password, requestId);
    return { passwordSet: true, audience: r.audience, loginPath: r.audience === "staff" ? "/admin/giris" : "/giris" };
  },
});
