/** Public surface of the identity module (login, logout, sessions, permissions). */
export { ADMIN_SESSION_COOKIE, LEGACY_SESSION_COOKIE, LOGIN_LIMITS, STOREFRONT_SESSION_COOKIE } from "./domain/session-policy";
export type { AccountTokenPurpose, CredentialWriter, LoginListener, PasswordHasher, SessionCookies, SessionRepository } from "./application/ports";
export { LINK_TTL_MINUTES, accountLinkPath, type IssuedLink, type LinkInfo } from "./application/account-links";
export { PASSWORD_MAX, PASSWORD_MIN, passwordProblems } from "./domain/password-policy";
export { completeLinkSchema, loginSchema } from "./http/schemas";
export {
  AccountLinksToken, CompleteAccountLinkToken, CredentialWriterToken, PasswordHasherToken, PeekAccountLinkToken, SessionRepositoryToken,
  GetCurrentPrincipalToken, GetCustomerProfileToken, GetStaffRolesToken, LoginToken, LogoutToken, SessionCookiesToken, addLoginListener, registerIdentity,
} from "./module";
