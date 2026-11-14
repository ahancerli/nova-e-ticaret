import { RenewConsentToken } from "@/modules/consent";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST /api/admin/consent/renew — revision + 1: every visitor is asked again on the next page view. */
export const POST = route({
  auth: { audience: "admin", permission: "integrations.write" },
  rateLimit: { name: "consent-renew", limit: 5, windowSec: 60 },
  handle: (ctx) => ctx.resolve(RenewConsentToken).execute(actorOf(ctx)),
});
