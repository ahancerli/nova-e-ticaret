import { ClockToken, ConfigToken, DatabaseToken, IdempotencyStoreToken, OriginGuardToken, RateLimiterToken, type Container } from "@/core";
import { D1IdempotencyStore } from "./idempotency-store";
import { D1RateLimiter, SameOriginGuard } from "./request-security";

/** Binds the core HTTP pipeline ports (CSRF, rate limit, idempotency) to their D1 / config-backed implementations. */
export function registerPlatform(c: Container): void {
  c.scoped(OriginGuardToken, (r) => new SameOriginGuard(r.resolve(ConfigToken).publicSiteUrl));
  c.scoped(RateLimiterToken, (r) => new D1RateLimiter(r.resolve(DatabaseToken), r.resolve(ClockToken), r.resolve(ConfigToken).sessionSecret));
  c.scoped(IdempotencyStoreToken, (r) => new D1IdempotencyStore(r.resolve(DatabaseToken), r.resolve(ClockToken)));
}

export { clientIp } from "./request-security";
