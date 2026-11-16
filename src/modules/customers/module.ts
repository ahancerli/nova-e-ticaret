import { ClockToken, DatabaseToken, IdGeneratorToken, RateLimiterToken, token, type Container, type Resolver } from "@/core";
import { IysQueueToken } from "@/modules/iys";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { GetSignupLegalToken } from "@/modules/content";
import { GeoDirectoryToken } from "@/modules/geo";
import { AccountLinksToken, CredentialWriterToken, PasswordHasherToken, SessionRepositoryToken } from "@/modules/identity";
import { CustomerEnrollment, GetCustomer, ListCustomers, RegisterCustomer, RunCustomerAction, UpdateCustomer, type CustomerDeps } from "./application/customer-use-cases";
import type { CustomerRepository } from "./application/ports";
import { D1CustomerRepository } from "./infrastructure/d1-customer.repository";

export const CustomerRepositoryToken = token<CustomerRepository>("CustomerRepository");
export const ListCustomersToken = token<ListCustomers>("ListCustomers");
export const GetCustomerToken = token<GetCustomer>("GetCustomer");
export const UpdateCustomerToken = token<UpdateCustomer>("UpdateCustomer");
export const RunCustomerActionToken = token<RunCustomerAction>("RunCustomerAction");
export const RegisterCustomerToken = token<RegisterCustomer>("RegisterCustomer");
/** Statements that create a member; shared by password sign-up and social sign-up. */
export const CustomerEnrollmentToken = token<CustomerEnrollment>("CustomerEnrollment");

export function registerCustomers(c: Container): void {
  const deps = (r: Resolver): CustomerDeps => ({
    db: r.resolve(DatabaseToken), customers: r.resolve(CustomerRepositoryToken), sessions: r.resolve(SessionRepositoryToken),
    links: r.resolve(AccountLinksToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken),
  });
  c.scoped(CustomerRepositoryToken, (r) => new D1CustomerRepository(r.resolve(DatabaseToken)));
  c.scoped(ListCustomersToken, (r) => new ListCustomers(r.resolve(CustomerRepositoryToken)));
  c.scoped(GetCustomerToken, (r) => new GetCustomer(r.resolve(CustomerRepositoryToken), r.resolve(ClockToken)));
  c.scoped(UpdateCustomerToken, (r) => new UpdateCustomer(deps(r)));
  c.scoped(RunCustomerActionToken, (r) => new RunCustomerAction(deps(r)));
  c.scoped(CustomerEnrollmentToken, (r) => new CustomerEnrollment({
    customers: r.resolve(CustomerRepositoryToken), legal: r.resolve(GetSignupLegalToken), audit: r.resolve(AuditLogToken),
    clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken), iys: r.resolve(IysQueueToken),
  }));
  c.scoped(RegisterCustomerToken, (r) => new RegisterCustomer({
    db: r.resolve(DatabaseToken), enrollment: r.resolve(CustomerEnrollmentToken), credentials: r.resolve(CredentialWriterToken),
    passwords: r.resolve(PasswordHasherToken), limiter: r.resolve(RateLimiterToken), geo: r.resolve(GeoDirectoryToken), clock: r.resolve(ClockToken),
  }));
}
