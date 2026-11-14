import "server-only";
import { redirect } from "next/navigation";
import {
  ClockToken,
  ConfigToken,
  Container,
  CryptoIdGenerator,
  SqlDatabaseAdapter,
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
import { registerAi } from "@/modules/ai";
import { registerMail } from "@/modules/mail";
import { registerAuditModule } from "@/modules/audit";
import { registerBulk } from "@/modules/bulk";
import { registerMarketplaces } from "@/modules/marketplaces";
import { registerMessaging } from "@/modules/messaging";
import { registerCampaigns } from "@/modules/campaigns";
import { registerCaptcha } from "@/modules/captcha";
import { registerCart } from "@/modules/cart";
import { registerCatalog } from "@/modules/catalog";
import { registerCheckout } from "@/modules/checkout";
import { registerAddresses } from "@/modules/addresses";
import { registerGeo } from "@/modules/geo";
import { registerConsent } from "@/modules/consent";
import { registerContent } from "@/modules/content";
import { registerCustomers } from "@/modules/customers";
import { GetCurrentPrincipalToken, registerIdentity } from "@/modules/identity";
import { registerMedia } from "@/modules/media";
import { registerPanelNotifications } from "@/modules/notifications";
import { registerNotifications } from "@/modules/notifications/notifications";
import { registerOrders } from "@/modules/orders";
import { registerOutbox } from "@/modules/outbox";
import { registerPayments } from "@/modules/payments";
import { registerIntegrations } from "@/modules/integrations";
import { registerPlatform } from "@/modules/platform/module";
import { registerSecrets } from "@/modules/platform/secrets";
import { registerPricing } from "@/modules/pricing";
import { registerReporting } from "@/modules/reporting";
import { registerInvoices } from "@/modules/invoices";
import { registerReturns } from "@/modules/returns";
import { registerReviews } from "@/modules/reviews";
import { registerSettings } from "@/modules/settings";
import { registerShipping, registerShippingRates } from "@/modules/shipping";
import { registerShowcase } from "@/modules/showcase";
import { registerSupport } from "@/modules/support";
import { registerStaff } from "@/modules/staff";
import { registerStorefront } from "@/modules/storefront";
import { getEnv } from "./env";
import { errorReporter } from "./error-reporter";

/**
 * Composition root: the only place that knows concrete implementations.
 * Route files import `route`; server components use `resolveService`, `currentPrincipal`, `requireAdminPage`.
 */
export const container = new Container();

const isDev = () => process.env.NODE_ENV !== "production";

// --- infrastructure (singletons are stateless; per-request things are scoped) ---------------------
// every `error` line also goes to the error monitor when SENTRY_DSN is set (src/server/error-reporter.ts)
container.singleton(LoggerToken, () => new JsonLogger({ level: isDev() ? "debug" : "info", report: errorReporter().fromLog }));
container.singleton(ClockToken, () => new SystemClock());
container.singleton(IdGeneratorToken, () => new CryptoIdGenerator());
container.scoped(ConfigToken, (c) => buildConfig(c.resolve(EnvToken), process.env));
container.scoped(DatabaseToken, (c) => new SqlDatabaseAdapter(c.resolve(EnvToken).DB));

// --- modules -------------------------------------------------------------------------------------
registerPlatform(container);
registerSecrets(container);
registerOutbox(container);
registerIdentity(container);
registerAuditModule(container); // AuditLog for every module + audit log viewer
registerStaff(container); // panel users + roles (invitation links from identity)
registerMedia(container);
registerAi(container); // single AI provider + "AI ile ürün ekle" (images via MediaLibrary)
registerMail(container); // SMTP settings + MailSender port (identity: password reset e-mails)
registerSettings(container);
registerCaptcha(container); // bot protection: CaptchaGuard behind route({ captcha }) + Ayarlar › Bot koruması
registerPanelNotifications(container); // bell + Bildirimler; NotificationPublisher for reviews, order / payment outbox handlers
registerContent(container); // {{placeholders}} from settings
registerConsent(container); // cookie consent (KVKK banner + proof) and tracking tags; cookie policy version from content
registerCustomers(container); // members + storefront sign-up (consent versions from content)
registerCatalog(container);
registerStorefront(container);
registerAddresses(container); // Hesabım › Adreslerim + checkout address picker
registerGeo(container); // countries + phone rules, provinces, districts (sign-up, addresses, checkout)
registerInvoices(container); // e-Arşiv faturalar: panel attach (PDF in private storage), customer download + e-mail
registerReturns(container); // iade (cayma hakkı) talepleri: customer request → panel decision → order refund
registerReviews(container); // product reviews & ratings: moderation, store reply, reviewer contact (mail + notifications)
registerSupport(container); // Canlı destek: member ↔ staff chat, live events via GraphQL subscription over SSE (in-process hub)
registerPricing(container);
registerCampaigns(container);
registerBulk(container);
registerMessaging(container);
registerMarketplaces(container);
registerShowcase(container);
registerCart(container); // also subscribes the guest-cart merge to storefront logins
registerCheckout(container);
registerOrders(container);
registerPayments(container); // + outbox handler refund.process
registerIntegrations(container); // SMS / cargo firm catalog, settings, adapters (runtime port for shipping + notifications)
registerShipping(container); // + outbox handler order.shipped (carrier booking), tracking sync
registerShippingRates(container); // Kargo ücretleri (panel)
registerReporting(container);
registerNotifications(); // + customer / staff notification handlers

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
