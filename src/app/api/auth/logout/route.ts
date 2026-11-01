import { handler, ok } from "@/server/http";
import { assertSameOrigin } from "@/server/security";
import { logout } from "@/server/auth";

export const dynamic = "force-dynamic";
/** Backward-compatible storefront logout endpoint. Prefer /api/storefront/auth/logout for new calls. */

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  await logout("storefront");
  return ok(req, { loggedOut: true });
});
