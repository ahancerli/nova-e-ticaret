import { handler, ok, readJson } from "@/server/http";
import { assertSameOrigin, ipHash, rateLimit } from "@/server/security";
import { login, setSessionCookie } from "@/server/auth";
import { mergeGuestCartInto } from "@/server/services/cart";
import { loginSchema } from "@/server/validation";
import { queryFirst } from "@/server/db";

export const dynamic = "force-dynamic";
/** Backward-compatible storefront login endpoint. Prefer /api/storefront/auth/login for new calls. */

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const ip = await ipHash(req);
  // Spec: max 5 failed logins per IP per minute.
  await rateLimit({ key: `login-fail:${ip}`, limit: 5, windowSec: 60, record: false });
  const { email, password } = loginSchema.parse(await readJson(req));
  try {
    const session = await login(email, password, ip, "storefront");
    await setSessionCookie(session.token, session.expiresAt, "storefront");
    const user = await queryFirst<{ id: string }>("SELECT id FROM users WHERE email_normalized = ?", email.trim().toLowerCase());
    if (user) await mergeGuestCartInto(user.id);
    return ok(req, { loggedIn: true });
  } catch (err) {
    await rateLimit({ key: `login-fail:${ip}`, limit: 5, windowSec: 60 }).catch(() => undefined);
    throw err;
  }
});
