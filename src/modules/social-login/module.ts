import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, RateLimiterToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { CustomerEnrollmentToken } from "@/modules/customers";
import { CredentialWriterToken, SessionCookiesToken, SessionIssuerToken, SessionRepositoryToken } from "@/modules/identity";
import { SocialFlowState } from "./application/flow-state";
import type { OidcClient, SocialIdentityRepository, SocialProviderRepository } from "./application/ports";
import {
  CompleteSocialLogin, FinishSocialSignup, GetEnabledSocialProviders, GetPendingSocialSignup, GetSocialLoginSettings, SaveSocialProvider, StartSocialLogin,
  type SocialDeps,
} from "./application/social-use-cases";
import { D1SocialIdentityRepository, D1SocialProviderRepository } from "./infrastructure/d1-social.repositories";
import { HttpOidcClient } from "./infrastructure/http-oidc-client";

export const SocialProviderRepositoryToken = token<SocialProviderRepository>("SocialProviderRepository");
export const SocialIdentityRepositoryToken = token<SocialIdentityRepository>("SocialIdentityRepository");
/** Provider HTTP client (token exchange, key probe); tests replace this token with a fake. */
export const OidcClientToken = token<OidcClient>("OidcClient");
export const SocialFlowStateToken = token<SocialFlowState>("SocialFlowState");
export const GetSocialLoginSettingsToken = token<GetSocialLoginSettings>("GetSocialLoginSettings");
export const GetEnabledSocialProvidersToken = token<GetEnabledSocialProviders>("GetEnabledSocialProviders");
export const SaveSocialProviderToken = token<SaveSocialProvider>("SaveSocialProvider");
export const StartSocialLoginToken = token<StartSocialLogin>("StartSocialLogin");
export const CompleteSocialLoginToken = token<CompleteSocialLogin>("CompleteSocialLogin");
export const GetPendingSocialSignupToken = token<GetPendingSocialSignup>("GetPendingSocialSignup");
export const FinishSocialSignupToken = token<FinishSocialSignup>("FinishSocialSignup");

export function registerSocialLogin(c: Container): void {
  const deps = (r: Resolver): SocialDeps => {
    const config = r.resolve(ConfigToken);
    return {
      db: r.resolve(DatabaseToken), providers: r.resolve(SocialProviderRepositoryToken), identities: r.resolve(SocialIdentityRepositoryToken),
      oidc: r.resolve(OidcClientToken), flow: r.resolve(SocialFlowStateToken), issuer: r.resolve(SessionIssuerToken),
      enrollment: r.resolve(CustomerEnrollmentToken), credentials: r.resolve(CredentialWriterToken), sessions: r.resolve(SessionRepositoryToken),
      limiter: r.resolve(RateLimiterToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
      logger: r.resolve(LoggerToken), masterKey: config.secretsMasterKey, siteUrl: config.publicSiteUrl,
    };
  };
  // one instance: it caches the providers' signing keys
  c.singleton(OidcClientToken, () => new HttpOidcClient());
  c.scoped(SocialProviderRepositoryToken, (r) => new D1SocialProviderRepository(r.resolve(DatabaseToken)));
  c.scoped(SocialIdentityRepositoryToken, (r) => new D1SocialIdentityRepository(r.resolve(DatabaseToken)));
  c.scoped(SocialFlowStateToken, (r) => new SocialFlowState(r.resolve(SessionCookiesToken), r.resolve(ConfigToken).sessionSecret, r.resolve(ClockToken)));
  c.scoped(GetSocialLoginSettingsToken, (r) => new GetSocialLoginSettings({ providers: r.resolve(SocialProviderRepositoryToken), siteUrl: r.resolve(ConfigToken).publicSiteUrl }));
  c.scoped(GetEnabledSocialProvidersToken, (r) => new GetEnabledSocialProviders(r.resolve(SocialProviderRepositoryToken)));
  c.scoped(SaveSocialProviderToken, (r) => new SaveSocialProvider(deps(r)));
  c.scoped(StartSocialLoginToken, (r) => new StartSocialLogin(deps(r)));
  c.scoped(CompleteSocialLoginToken, (r) => new CompleteSocialLogin(deps(r)));
  c.scoped(GetPendingSocialSignupToken, (r) => new GetPendingSocialSignup(r.resolve(SocialFlowStateToken)));
  c.scoped(FinishSocialSignupToken, (r) => new FinishSocialSignup(deps(r)));
}
