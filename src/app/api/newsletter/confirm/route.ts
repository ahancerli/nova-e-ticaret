import { ConfirmNewsletterToken, newsletterConfirmSchema } from "@/modules/newsletter";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST `{ token }` — the button on /bulten/onay (a POST, so link scanners that open e-mails cannot confirm). */
export const POST = route({
  auth: { audience: "storefront" },
  body: newsletterConfirmSchema,
  rateLimit: { name: "newsletter-confirm", limit: 20, windowSec: 60 * 60 },
  handle: ({ body, resolve }) => resolve(ConfirmNewsletterToken).execute(body.token),
});
