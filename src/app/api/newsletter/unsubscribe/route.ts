import { UnsubscribeNewsletterToken, newsletterUnsubscribeSchema } from "@/modules/newsletter";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST `{ id, sig }` — the button on /bulten/ayril (signed link from the newsletter footer). */
export const POST = route({
  auth: { audience: "storefront" },
  body: newsletterUnsubscribeSchema,
  rateLimit: { name: "newsletter-unsubscribe", limit: 20, windowSec: 60 * 60 },
  handle: ({ body, resolve }) => resolve(UnsubscribeNewsletterToken).execute(body.id, body.sig),
});
