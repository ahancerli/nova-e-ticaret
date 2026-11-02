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
  type Token,
} from "@/core";
import { registerAudit } from "@/modules/audit/audit-log";
import { registerCatalog } from "@/modules/catalog";
import { registerMedia } from "@/modules/media";
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

// --- modules -------------------------------------------------------------------------------------
registerAudit(container);
registerMedia(container);
registerCatalog(container);

/** Fills a request scope with per-request values. getEnv() adds local .env fallbacks for secrets. */
async function prepareScope(scope: Container): Promise<void> {
  scope.provide(EnvToken, await getEnv());
}

/** HTTP routes: `export const GET = route({ ... })`. */
export const route = createRouter({ root: container, prepareScope, exposeStack: isDev });

/**
 * Server components (pages/layouts) resolve queries through this; each call gets its own request scope.
 * Authorization stays with the page (requirePermission) — queries do not check permissions.
 */
export async function resolveService<T>(t: Token<T>): Promise<T> {
  const scope = container.createScope();
  scope.provide(LoggerToken, container.resolve(LoggerToken));
  await prepareScope(scope);
  return scope.resolve(t);
}
