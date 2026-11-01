import { handler, ok, readJson } from "@/server/http";
import { assertSameOrigin, ipHash, rateLimit } from "@/server/security";
import { login, setSessionCookie } from "@/server/auth";
import { loginSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  const ip = await ipHash(req);
  await rateLimit({ key: `admin-login-fail:${ip}`, limit: 5, windowSec: 60, record: false });
  const { email, password } = loginSchema.parse(await readJson(req));
  try {
    const session = await login(email, password, ip, "admin");
    await setSessionCookie(session.token, session.expiresAt, "admin");
    return ok(req, { loggedIn: true, audience: "admin" });
  } catch (err) {
    await rateLimit({ key: `admin-login-fail:${ip}`, limit: 5, windowSec: 60 }).catch(() => undefined);
    throw err;
  }
});
