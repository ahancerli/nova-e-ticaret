import { handler, ok } from "@/server/http";
import { assertSameOrigin } from "@/server/security";
import { logout } from "@/server/auth";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  await logout("storefront");
  return ok(req, { loggedOut: true, audience: "storefront" });
});
