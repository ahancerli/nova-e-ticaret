/** Public surface of the social-login module: storefront sign-in through an identity provider (Google). */
export * from "./domain/social";
export type { OidcClient } from "./application/ports";
export type { SocialCallback } from "./application/social-use-cases";
export { OAUTH_FLOW_COOKIE, SOCIAL_SIGNUP_COOKIE } from "./application/flow-state";
export { socialCallbackQuery, socialProviderParams, socialProviderSchema, socialSignupSchema, socialStartQuery } from "./http/schemas";
export {
  CompleteSocialLoginToken, FinishSocialSignupToken, GetEnabledSocialProvidersToken, GetPendingSocialSignupToken, GetSocialLoginSettingsToken, OidcClientToken,
  SaveSocialProviderToken, StartSocialLoginToken, registerSocialLogin,
} from "./module";
