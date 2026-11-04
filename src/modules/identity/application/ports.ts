import type { Audience, Statement } from "@/core";

export interface Credential {
  userId: string;
  status: string;
  passwordHash: string;
  isStaff: boolean;
}

/** Account behind an e-mail, with or without a password yet (password reset). */
export interface AccountByEmail {
  userId: string;
  email: string;
  displayName: string;
  status: string;
  isStaff: boolean;
}

export interface CredentialRepository {
  findByEmail(emailNormalized: string): Promise<Credential | null>;
  findAccount(emailNormalized: string): Promise<AccountByEmail | null>;
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
  /** Ends every open session of a user (password change, suspension, staff "sign out everywhere"). */
  revokeAllStatement(userId: string, now: string): Statement;
  /** Records the sign-in time on the user (admin user / customer lists). */
  touchLoginStatement(userId: string, now: string): Statement;
  findActive(tokenHash: string, now: string): Promise<ActiveSession | null>;
  revoke(tokenHash: string, now: string): Promise<void>;
}

/** One-time account links: staff invitation, password reset. Only the token's HMAC is stored. */
export type AccountTokenPurpose = "staff_invite" | "password_reset";

export interface AccountTokenHolder {
  tokenId: string;
  userId: string;
  purpose: AccountTokenPurpose;
  email: string;
  displayName: string;
  isStaff: boolean;
  status: string;
}

export interface AccountTokenRepository {
  /** Earlier unused links of the same purpose stop working when a new one is issued. */
  invalidateStatement(userId: string, purpose: AccountTokenPurpose, now: string): Statement;
  insertStatement(t: { id: string; userId: string; purpose: AccountTokenPurpose; tokenHash: string; expiresAt: string }): Statement;
  findValid(tokenHash: string, now: string): Promise<AccountTokenHolder | null>;
  /** Guarded: only an unconsumed, unexpired token is consumed (0 rows = used meanwhile). */
  consumeStatement(tokenId: string, now: string): Statement;
  pending(userId: string, purpose: AccountTokenPurpose, now: string): Promise<{ expiresAt: string } | null>;
}

export interface CredentialWriter {
  /** Sets (or replaces) the password and clears failure counters. */
  setPasswordStatement(userId: string, passwordHash: string, now: string): Statement;
  markEmailVerifiedStatement(userId: string, now: string): Statement;
}

export interface PermissionRepository {
  permissionsOf(userId: string): Promise<string[]>;
}

export interface PasswordHasher {
  /** Constant-ish time: compares against a dummy hash when `hash` is null so timing does not reveal unknown e-mails. */
  verify(plain: string, hash: string | null): Promise<boolean>;
  hash(plain: string): Promise<string>;
}

/** Opaque session / account tokens; only their HMAC is stored (separate HMAC scopes per use). */
export interface TokenService {
  newToken(): string;
  hash(token: string): Promise<string>;
  hashAccountToken(token: string): Promise<string>;
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
