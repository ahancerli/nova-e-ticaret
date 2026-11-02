import { AuthenticatorToken, ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, RateLimiterToken, token, type Container, type Resolver } from "@/core";
import type { CredentialRepository, LoginListener, PasswordHasher, PermissionRepository, SessionCookies, SessionRepository, TokenService } from "./application/ports";
import { D1AccountReadModel, GetCustomerProfile, GetStaffRoles } from "./application/account-queries";
import { GetCurrentPrincipal, Login, Logout } from "./application/session-use-cases";
import { BcryptPasswordHasher, HmacTokenService, NextSessionCookies } from "./infrastructure/adapters";
import { D1CredentialRepository, D1PermissionRepository, D1SessionRepository } from "./infrastructure/d1-identity.repositories";

export const CredentialRepositoryToken = token<CredentialRepository>("CredentialRepository");
export const SessionRepositoryToken = token<SessionRepository>("SessionRepository");
export const PermissionRepositoryToken = token<PermissionRepository>("PermissionRepository");
export const PasswordHasherToken = token<PasswordHasher>("PasswordHasher");
export const TokenServiceToken = token<TokenService>("TokenService");
export const SessionCookiesToken = token<SessionCookies>("SessionCookies");
/** All login listeners (Observer). Other modules contribute via `addLoginListener`. */
export const LoginListenersToken = token<LoginListener[]>("LoginListeners");

export const GetCurrentPrincipalToken = token<GetCurrentPrincipal>("GetCurrentPrincipal");
export const LoginToken = token<Login>("Login");
export const LogoutToken = token<Logout>("Logout");
export const GetStaffRolesToken = token<GetStaffRoles>("GetStaffRoles");
export const GetCustomerProfileToken = token<GetCustomerProfile>("GetCustomerProfile");

const listeners: ((r: Resolver) => LoginListener)[] = [];

/** Lets another module react to logins without identity depending on it. Call before the first request. */
export function addLoginListener(factory: (r: Resolver) => LoginListener): void {
  listeners.push(factory);
}

export function registerIdentity(c: Container): void {
  c.scoped(CredentialRepositoryToken, (r) => new D1CredentialRepository(r.resolve(DatabaseToken)));
  c.scoped(SessionRepositoryToken, (r) => new D1SessionRepository(r.resolve(DatabaseToken)));
  c.scoped(PermissionRepositoryToken, (r) => new D1PermissionRepository(r.resolve(DatabaseToken)));
  c.singleton(PasswordHasherToken, () => new BcryptPasswordHasher());
  c.scoped(TokenServiceToken, (r) => new HmacTokenService(r.resolve(ConfigToken).sessionSecret));
  c.singleton(SessionCookiesToken, () => new NextSessionCookies());
  c.scoped(LoginListenersToken, (r) => listeners.map((make) => make(r)));

  c.scoped(GetCurrentPrincipalToken, (r) => new GetCurrentPrincipal(
    r.resolve(SessionRepositoryToken), r.resolve(PermissionRepositoryToken), r.resolve(SessionCookiesToken), r.resolve(TokenServiceToken), r.resolve(ClockToken),
  ));
  // The HTTP pipeline's Authenticator port is this query.
  c.scoped(AuthenticatorToken, (r) => r.resolve(GetCurrentPrincipalToken));
  c.scoped(LoginToken, (r) => new Login({
    db: r.resolve(DatabaseToken),
    credentials: r.resolve(CredentialRepositoryToken),
    sessions: r.resolve(SessionRepositoryToken),
    passwords: r.resolve(PasswordHasherToken),
    tokens: r.resolve(TokenServiceToken),
    cookies: r.resolve(SessionCookiesToken),
    limiter: r.resolve(RateLimiterToken),
    listeners: r.resolve(LoginListenersToken),
    clock: r.resolve(ClockToken),
    ids: r.resolve(IdGeneratorToken),
    logger: r.resolve(LoggerToken),
  }));
  c.scoped(GetStaffRolesToken, (r) => new GetStaffRoles(new D1AccountReadModel(r.resolve(DatabaseToken))));
  c.scoped(GetCustomerProfileToken, (r) => new GetCustomerProfile(new D1AccountReadModel(r.resolve(DatabaseToken))));
  c.scoped(LogoutToken, (r) => new Logout(r.resolve(SessionRepositoryToken), r.resolve(SessionCookiesToken), r.resolve(TokenServiceToken), r.resolve(ClockToken)));
}
