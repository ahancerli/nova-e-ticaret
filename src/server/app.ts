import "server-only";
import { redirect } from "next/navigation";
import {
  ClockToken,
  ConfigToken,
  Container,
  CryptoIdGenerator,
  D1DatabaseAdapter,
  DatabaseToken,
  EnvToken,
  IdGeneratorToken,
  JsonLogger,
  LoggerToken,
  SystemClock,
  buildConfig,
  createRouter,
  type Audience,
  type Principal,
  type Token,
} from "@/core";
import { registerAudit } from "@/modules/audit/audit-log";
import { registerCatalog } from "@/modules/catalog";
import { GetCurrentPrincipalToken, addLoginListener, registerIdentity } from "@/modules/identity";
import { registerMedia } from "@/modules/media";
import { registerPlatform } from "@/modules/platform/module";
import { getEnv } from "./db";

/**
 * Composition root: the only place that knows concrete implementations.
 * Route files import `route`; server components use `resolveService`, `currentPrincipal`, `requireAdminPage`.
 */
export const container = new Container();

const isDev = () => process.env.NODE_ENV !== "production";

// --- infrastructure (singletons are stateless; per-request things are scoped) ---------------------
container.singleton(LoggerToken, () => new JsonLogger({ level: isDev() ? "debug" : "info" }));
container.singleton(ClockToken, () => new SystemClock());
container.singleton(IdGeneratorToken, () => new CryptoIdGenerator());
container.scoped(ConfigToken, (c) => buildConfig(c.resolve(EnvToken), process.env));
container.scoped(DatabaseToken, (c) => new D1DatabaseAdapter(c.resolve(EnvToken).DB));

// --- modules -------------------------------------------------------------------------------------
registerPlatform(container);
registerIdentity(container);
registerAudit(container);
registerMedia(container);
registerCatalog(container);

// Storefront login merges the guest cart into the customer's cart. Loaded lazily: the cart service
// still lives in src/server/services and imports this file.
addLoginListener(() => ({
  onLogin: async ({ userId, audience }) => {
    if (audience !== "storefront") return;
    const { mergeGuestCartInto } = await import("./services/cart");
    await mergeGuestCartInto(userId);
  },
}));

/** Fills a request scope with per-request values. getEnv() adds local .env fallbacks for secrets. */
async function prepareScope(scope: Container): Promise<void> {
  scope.provide(EnvToken, await getEnv());
}

/** HTTP routes: `export const GET = route({ ... })`. */
export const route = createRouter({ root: container, prepareScope, exposeStack: isDev });

/**
 * Server components (pages/layouts) resolve queries through this; each call gets its own request scope.
 * Authorization stays with the page (`requireAdminPage`) — queries do not check permissions.
 */
export async function resolveService<T>(t: Token<T>): Promise<T> {
  const scope = container.createScope();
  scope.provide(LoggerToken, container.resolve(LoggerToken));
  await prepareScope(scope);
  return scope.resolve(t);
}

/** The signed-in principal of an audience for server components (null when anonymous). */
export async function currentPrincipal(audience: Audience): Promise<Principal | null> {
  return (await resolveService(GetCurrentPrincipalToken)).current(audience);
}

/**
 * Page guard for admin server components: no session → login page, missing permission → "no access"
 * page. (API routes use `route({ auth })`, which answers 401/403 instead of redirecting.)
 */
export async function requireAdminPage(permission?: string): Promise<Principal> {
  const user = await currentPrincipal("admin");
  if (!user || !user.isStaff) redirect("/admin/giris");
  if (permission && !user.permissions.has(permission)) redirect("/admin/yetkisiz");
  return user;
}
