import "server-only";
import {
  AuthenticatorToken,
  ClockToken,
  ConfigToken,
  Container,
  CryptoIdGenerator,
  D1DatabaseAdapter,
  DatabaseToken,
  EnvToken,
  IdGeneratorToken,
  IdempotencyStoreToken,
  JsonLogger,
  LoggerToken,
  OriginGuardToken,
  RateLimiterToken,
  SystemClock,
  buildConfig,
  createRouter,
  type Authenticator,
  type IdempotencyStore,
  type OriginGuard,
  type RateLimiter,
} from "@/core";
import { currentUser } from "./auth";
import { getEnv } from "./db";
import { withIdempotency } from "./idempotency";
import { assertSameOrigin, ipHash, rateLimit } from "./security";

/**
 * Composition root: the only place that knows concrete implementations.
 * Modules add their own registrations through `registerModule()` (Phase 3); route files import `route`.
 */
export const container = new Container();

const isDev = () => process.env.NODE_ENV !== "production";

// --- infrastructure (singletons are stateless; per-request things are scoped) ---------------------
container.singleton(LoggerToken, () => new JsonLogger({ level: isDev() ? "debug" : "info" }));
container.singleton(ClockToken, () => new SystemClock());
container.singleton(IdGeneratorToken, () => new CryptoIdGenerator());
container.scoped(ConfigToken, (c) => buildConfig(c.resolve(EnvToken), process.env));
container.scoped(DatabaseToken, (c) => new D1DatabaseAdapter(c.resolve(EnvToken).DB));

// --- HTTP pipeline ports → existing server adapters ------------------------------------------------
container.singleton(AuthenticatorToken, (): Authenticator => ({ current: (audience) => currentUser(audience) }));
container.singleton(OriginGuardToken, (): OriginGuard => ({ assert: (req, mode) => assertSameOrigin(req, { multipart: mode === "multipart" }) }));
container.singleton(RateLimiterToken, (): RateLimiter => ({
  hit: (key, limit, windowSec) => rateLimit({ key, limit, windowSec }),
  check: (key, limit, windowSec) => rateLimit({ key, limit, windowSec, record: false }),
  clientKey: (req) => ipHash(req),
}));
container.singleton(IdempotencyStoreToken, (): IdempotencyStore => ({ run: (req, scope, body, fn) => withIdempotency(req, scope, body, fn) }));

/** Registers a module's bindings on the root container (called once at module load). */
export function registerModule(register: (c: Container) => void): void {
  register(container);
}

export const route = createRouter({
  root: container,
  prepareScope: async (scope) => {
    // getEnv() adds the local .env fallbacks for secrets on top of the Worker bindings.
    scope.provide(EnvToken, await getEnv());
  },
  exposeStack: isDev,
});
