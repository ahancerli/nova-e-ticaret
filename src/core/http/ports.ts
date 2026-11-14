import { token } from "../di/container";
import type { Logger } from "../logging/logger";

/**
 * Ports the HTTP pipeline needs from the application. core/ only knows these interfaces; the
 * composition root (src/server/app.ts) binds them to concrete implementations.
 */

/** The authenticated caller. Identity comes only from the session cookie, never from the request body. */
export interface Principal {
  id: string;
  email: string;
  displayName: string;
  sessionId: string;
  isStaff: boolean;
  permissions: ReadonlySet<string>;
}

export type Audience = "storefront" | "admin";

export interface Authenticator {
  /** The session for the given audience, or null. Never throws for "no session". */
  current(audience: Audience): Promise<Principal | null>;
}

export interface OriginGuard {
  /** Throws ForbiddenError / UnsupportedMediaTypeError for cross-site or wrongly typed writes. */
  assert(req: Request, mode: "json" | "multipart"): Promise<void>;
}

export interface RateLimiter {
  /** Counts one hit for `key` and throws RateLimitError once `limit` hits in `windowSec` are exceeded. */
  hit(key: string, limit: number, windowSec: number): Promise<void>;
  /** Throws if the bucket is already at `limit`, without counting. */
  check(key: string, limit: number, windowSec: number): Promise<void>;
  /** Stable, non-reversible identifier of the caller's IP (for bucket keys). */
  clientKey(req: Request): Promise<string>;
}

export interface CaptchaGuard {
  /**
   * Checks the request's CAPTCHA token for a protected form (e.g. "login"). No-op while protection is off or the form
   * is not selected; throws a 4xx AppError for a missing / rejected token.
   */
  assert(req: Request, form: string): Promise<void>;
}

export interface IdempotencyStore {
  /**
   * Runs `fn` at most once per (scope, Idempotency-Key header). Same key + same body → stored response;
   * same key + different body → ConflictError.
   */
  run<T>(req: Request, scope: string, body: unknown, fn: () => Promise<{ status: number; data: T }>): Promise<{ status: number; data: T; replayed: boolean }>;
}

/** Per-request values, provided into every request scope by the router. */
export interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  logger: Logger;
  startedAt: number;
}

export const AuthenticatorToken = token<Authenticator>("Authenticator");
export const OriginGuardToken = token<OriginGuard>("OriginGuard");
export const RateLimiterToken = token<RateLimiter>("RateLimiter");
export const CaptchaGuardToken = token<CaptchaGuard>("CaptchaGuard");
export const IdempotencyStoreToken = token<IdempotencyStore>("IdempotencyStore");
export const RequestContextToken = token<RequestContext>("RequestContext");
export const LoggerToken = token<Logger>("Logger");
/** The caller for the current request (null for public routes / anonymous storefront visitors). */
export const PrincipalToken = token<Principal | null>("Principal");
