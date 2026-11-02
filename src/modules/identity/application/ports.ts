import type { Audience, Statement } from "@/core";

export interface Credential {
  userId: string;
  status: string;
  passwordHash: string;
  isStaff: boolean;
}

export interface CredentialRepository {
  findByEmail(emailNormalized: string): Promise<Credential | null>;
  /** Counts failures for visibility (admin user screen); does not lock the account. */
  recordFailure(userId: string, now: string): Promise<void>;
  resetFailuresStatement(userId: string, now: string): Statement;
}

export interface ActiveSession {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  isStaff: boolean;
}

export interface SessionRepository {
  createStatement(s: { id: string; userId: string; tokenHash: string; expiresAt: string; ipHash: string }): Statement;
  findActive(tokenHash: string, now: string): Promise<ActiveSession | null>;
  revoke(tokenHash: string, now: string): Promise<void>;
}

export interface PermissionRepository {
  permissionsOf(userId: string): Promise<string[]>;
}

export interface PasswordHasher {
  /** Constant-ish time: compares against a dummy hash when `hash` is null so timing does not reveal unknown e-mails. */
  verify(plain: string, hash: string | null): Promise<boolean>;
}

/** Opaque session tokens; only their HMAC is stored. */
export interface TokenService {
  newToken(): string;
  hash(token: string): Promise<string>;
}

/** Cookie jar of the current request (Next.js cookies() in production, a Map in tests). */
export interface SessionCookies {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string, options: { expires: Date; sameSite: "lax" | "strict" }): Promise<void>;
  delete(name: string): Promise<void>;
}

/** Observer: other modules react to a successful login (e.g. the cart merges the guest cart). */
export interface LoginListener {
  onLogin(event: { userId: string; audience: Audience }): Promise<void>;
}
