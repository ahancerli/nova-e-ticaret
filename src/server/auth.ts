import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getDb, getEnv } from "./db";
import { hmacHex, randomToken } from "./crypto";
import { ApiError } from "./http";
import { addMinutesIso, newId, nowIso } from "@/lib/ids";

export const SESSION_COOKIE = "__Host-nova_session";
export const STOREFRONT_SESSION_COOKIE = "__Host-nova_store_session";
export const ADMIN_SESSION_COOKIE = "__Host-nova_admin_session";
const SESSION_TTL_MIN = 60 * 24 * 7;
const ADMIN_SESSION_TTL_MIN = 60 * 8;
const BCRYPT_COST = 12;
const LOCK_AFTER_FAILURES = 10;
const LOCK_MINUTES = 15;

// A real bcrypt hash (created once per isolate) compared against when the e-mail is unknown,
// so response time does not reveal whether an account exists.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hash(randomToken(16), BCRYPT_COST));

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  sessionId: string;
  isStaff: boolean;
  permissions: Set<string>;
}

export type AuthAudience = "storefront" | "admin";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

async function tokenHash(token: string): Promise<string> {
  const env = await getEnv();
  return hmacHex(env.SESSION_SECRET, `session:${token}`);
}

export async function login(
  email: string,
  password: string,
  ipHashValue: string,
  audience: AuthAudience = "storefront",
): Promise<{ token: string; expiresAt: string }> {
  const db = await getDb();
  const user = await db
    .prepare(
      `SELECT u.id, u.status, c.password_hash, c.failed_attempts, c.locked_until,
              EXISTS(SELECT 1 FROM staff_profiles s WHERE s.user_id = u.id) AS is_staff
         FROM users u JOIN auth_credentials c ON c.user_id = u.id
        WHERE u.email_normalized = ?`,
    )
    .bind(email.trim().toLowerCase())
    .first<{ id: string; status: string; password_hash: string; failed_attempts: number; locked_until: string | null; is_staff: number }>();

  const valid = await bcrypt.compare(password, user?.password_hash ?? (await getDummyHash()));
  const locked = user?.locked_until && user.locked_until > nowIso();

  // Same message for unknown user / wrong password / locked → no account enumeration.
  if (!user || !valid || locked || user.status !== "active") {
    if (user && !valid) {
      const failures = user.failed_attempts + 1;
      await db
        .prepare("UPDATE auth_credentials SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE user_id = ?")
        .bind(failures, failures >= LOCK_AFTER_FAILURES ? addMinutesIso(LOCK_MINUTES) : null, nowIso(), user.id)
        .run();
    }
    throw new ApiError(401, "invalid_credentials", "E-posta veya parola hatalı.");
  }

  if (audience === "admin" && !user.is_staff) {
    throw new ApiError(401, "invalid_credentials", "E-posta veya parola hatalı.");
  }

  const token = randomToken();
  const expiresAt = addMinutesIso(audience === "admin" ? ADMIN_SESSION_TTL_MIN : SESSION_TTL_MIN);
  await db.batch([
    db
      .prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_hash) VALUES (?, ?, ?, ?, ?)")
      .bind(newId(), user.id, await tokenHash(token), expiresAt, ipHashValue),
    db.prepare("UPDATE auth_credentials SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?").bind(nowIso(), user.id),
  ]);
  return { token, expiresAt };
}

function cookieName(audience: AuthAudience) {
  return audience === "admin" ? ADMIN_SESSION_COOKIE : STOREFRONT_SESSION_COOKIE;
}

function cookieNames(audience: AuthAudience) {
  return audience === "admin" ? [ADMIN_SESSION_COOKIE] : [STOREFRONT_SESSION_COOKIE, SESSION_COOKIE];
}

export async function setSessionCookie(token: string, expiresAt: string, audience: AuthAudience = "storefront") {
  (await cookies()).set(cookieName(audience), token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

async function revokeByCookie(name: string): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(name)?.value;
  if (token) {
    const db = await getDb();
    await db.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").bind(nowIso(), await tokenHash(token)).run();
  }
  jar.delete(name);
  return token ?? null;
}

export async function logout(audience: AuthAudience | "all" = "storefront") {
  if (audience === "all") {
    await revokeByCookie(STOREFRONT_SESSION_COOKIE);
    await revokeByCookie(SESSION_COOKIE);
    await revokeByCookie(ADMIN_SESSION_COOKIE);
    return;
  }
  for (const name of cookieNames(audience)) {
    await revokeByCookie(name);
  }
}

/** Reads the session from the cookie. Identity ALWAYS comes from here, never from request bodies. */
export async function currentUser(audience: AuthAudience = "storefront"): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = cookieNames(audience).map((name) => jar.get(name)?.value).find((v) => Boolean(v));
  if (!token) return null;
  const db = await getDb();
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, u.id, u.email_normalized, u.display_name,
              EXISTS(SELECT 1 FROM staff_profiles sp WHERE sp.user_id = u.id) AS is_staff
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`,
    )
    .bind(await tokenHash(token), nowIso())
    .first<{ session_id: string; id: string; email_normalized: string; display_name: string; is_staff: number }>();
  if (!row) return null;

  const { results } = await db
    .prepare(
      `SELECT DISTINCT p.code FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = ?`,
    )
    .bind(row.id)
    .all<{ code: string }>();

  return {
    id: row.id,
    email: row.email_normalized,
    displayName: row.display_name,
    sessionId: row.session_id,
    isStaff: row.is_staff === 1,
    permissions: new Set((results ?? []).map((r) => r.code)),
  };
}

export const currentStorefrontUser = () => currentUser("storefront");
export const currentAdminUser = () => currentUser("admin");

/** RBAC gate for admin route handlers. Hiding a button is not authorisation — call this. */
export async function requirePermission(code: string): Promise<SessionUser> {
  const user = await currentAdminUser();
  if (!user) throw new ApiError(401, "unauthenticated", "Giriş yapmanız gerekiyor.");
  if (!user.isStaff || !user.permissions.has(code)) throw new ApiError(403, "forbidden", "Bu işlem için yetkiniz yok.");
  // TODO(MFA): when ADMIN_MFA_ENFORCED=true require sessions.mfa_verified_at for staff with mfa_required=1.
  return user;
}

export async function audit(actorId: string | null, action: string, entityType: string, entityId: string | null, diff: unknown, reqId?: string) {
  const db = await getDb();
  await db
    .prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, diff_redacted_json, request_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(newId(), actorId, action, entityType, entityId, diff == null ? null : JSON.stringify(diff), reqId ?? null)
    .run();
}
