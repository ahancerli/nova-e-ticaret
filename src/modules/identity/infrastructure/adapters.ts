import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { hmacHex, randomToken } from "@/core";
import type { PasswordHasher, SessionCookies, TokenService } from "../application/ports";

const BCRYPT_COST = 12;

/** bcrypt (cost 12). Unknown e-mails are compared against a real dummy hash created once per isolate. */
export class BcryptPasswordHasher implements PasswordHasher {
  private static dummy: Promise<string> | null = null;

  async verify(plain: string, hash: string | null): Promise<boolean> {
    const target = hash ?? (await (BcryptPasswordHasher.dummy ??= bcrypt.hash(randomToken(16), BCRYPT_COST)));
    const ok = await bcrypt.compare(plain, target);
    return hash !== null && ok;
  }
}

/** Random 32-byte tokens; the DB keeps HMAC-SHA256(SESSION_SECRET, "session:<token>"). */
export class HmacTokenService implements TokenService {
  constructor(private readonly secret: string) {}

  newToken(): string {
    return randomToken();
  }

  hash(token: string): Promise<string> {
    return hmacHex(this.secret, `session:${token}`);
  }
}

/** Next.js request cookies. `__Host-` cookies: Secure, Path=/, no Domain; always HttpOnly. */
export class NextSessionCookies implements SessionCookies {
  async get(name: string): Promise<string | undefined> {
    return (await cookies()).get(name)?.value;
  }

  async set(name: string, value: string, options: { expires: Date; sameSite: "lax" | "strict" }): Promise<void> {
    (await cookies()).set(name, value, { httpOnly: true, secure: true, sameSite: options.sameSite, path: "/", expires: options.expires });
  }

  async delete(name: string): Promise<void> {
    (await cookies()).delete(name);
  }
}
