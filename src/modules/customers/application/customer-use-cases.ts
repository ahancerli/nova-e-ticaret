import { UnitOfWork, ValidationError, type Clock, type Database, type IdGenerator, type RateLimiter } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { GeoDirectory } from "@/modules/geo";
import { accountLinkPath, passwordProblems, type CredentialWriter, type IssuedLink, type PasswordHasher, type SessionRepository } from "@/modules/identity";
import type { Actor } from "@/modules/shared/actor";
import { CustomerErrors } from "../domain/errors";
import type { CustomerDetail, CustomerList, CustomerPatch, CustomerQuery, SignupInput } from "../domain/customer";
import type { CustomerRepository } from "./ports";

const textOrNull = (v: string | null | undefined) => v?.trim() || null;

/** Query: members with order totals, filtered by segment, searched, sorted and paged on the server. */
export class ListCustomers {
  constructor(private readonly customers: CustomerRepository) {}
  execute(q: CustomerQuery): Promise<CustomerList> {
    return this.customers.list(q);
  }
}

/** Query: one member — profile, totals, addresses, consent history, recent orders. */
export class GetCustomer {
  constructor(private readonly customers: CustomerRepository, private readonly clock: Clock) {}
  execute(id: string): Promise<CustomerDetail | null> {
    return this.customers.find(id, this.clock.nowIso());
  }
}

export interface CustomerDeps {
  db: Database;
  customers: CustomerRepository;
  sessions: SessionRepository;
  links: { issue(userId: string, purpose: "password_reset"): Promise<IssuedLink> };
  audit: AuditLog;
  clock: Clock;
}

/** Command: name, phone, company and the internal note (never shown to the customer). */
export class UpdateCustomer {
  constructor(private readonly deps: CustomerDeps) {}

  async execute(id: string, patch: CustomerPatch, actor: Actor): Promise<void> {
    const c = await this.deps.customers.find(id, this.deps.clock.nowIso());
    if (!c) throw CustomerErrors.notFound();
    const firstName = patch.firstName?.trim() || c.firstName;
    const lastName = patch.lastName?.trim() ?? c.lastName;
    const now = this.deps.clock.nowIso();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.customers.updateUserStatement(id, { displayName: `${firstName} ${lastName}`.trim(), phone: patch.phone !== undefined ? textOrNull(patch.phone) : c.phone }, now))
      .expectChanges(1, CustomerErrors.changedMeanwhile)
      .add(this.deps.customers.upsertProfileStatement(id, {
        firstName, lastName,
        companyName: patch.companyName !== undefined ? textOrNull(patch.companyName) : c.companyName,
        notes: patch.notes !== undefined ? textOrNull(patch.notes) : c.notes,
      }, now))
      .add(this.deps.audit.recordStatement({ actor, action: "customer.update", entityType: "user", entityId: id, diff: { ...patch, ...(patch.notes !== undefined ? { notes: "changed" } : {}) } }))
      .commit();
  }
}

export type CustomerAction = "suspend" | "reactivate" | "password_reset" | "revoke_sessions";

/**
 * Command: account actions. Suspension blocks sign-in and ends open sessions (orders stay); a reset link is
 * handed to the admin to pass on (no e-mail provider yet) and replaces earlier unused links.
 */
export class RunCustomerAction {
  constructor(private readonly deps: CustomerDeps) {}

  async execute(id: string, action: CustomerAction, actor: Actor): Promise<{ link?: { path: string; expiresAt: string } }> {
    const c = await this.deps.customers.find(id, this.deps.clock.nowIso());
    if (!c) throw CustomerErrors.notFound();
    const now = this.deps.clock.nowIso();
    const uow = new UnitOfWork(this.deps.db);
    let link: IssuedLink | undefined;
    switch (action) {
      case "suspend":
        uow.add(this.deps.customers.setStatusStatement(id, "suspended", now)).expectChanges(1, CustomerErrors.changedMeanwhile).add(this.deps.sessions.revokeAllStatement(id, now));
        break;
      case "reactivate":
        uow.add(this.deps.customers.setStatusStatement(id, "active", now)).expectChanges(1, CustomerErrors.changedMeanwhile);
        break;
      case "password_reset":
        if (c.status !== "active") throw CustomerErrors.notActive();
        link = await this.deps.links.issue(id, "password_reset");
        uow.add(...link.statements);
        break;
      case "revoke_sessions":
        uow.add(this.deps.sessions.revokeAllStatement(id, now));
        break;
    }
    await uow.add(this.deps.audit.recordStatement({ actor, action: `customer.${action}`, entityType: "user", entityId: id, diff: {} })).commit();
    return link ? { link: { path: accountLinkPath("customer", link.token), expiresAt: link.expiresAt } } : {};
  }
}

export interface SignupDeps {
  db: Database;
  customers: CustomerRepository;
  credentials: CredentialWriter;
  passwords: PasswordHasher;
  limiter: RateLimiter;
  geo: GeoDirectory;
  legal: { execute(): Promise<{ consentVersion: string }> };
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
}

/** Sign-ups per IP: 5 per hour (fake-account / enumeration brake). */
export const SIGNUP_LIMIT = { limit: 5, windowSec: 60 * 60 } as const;

/**
 * Command: storefront sign-up. The person chooses the password (policy-checked); the KVKK notice acknowledgement
 * and the marketing choices are stored as consents with the document versions shown on the form (İYS / KVKK
 * evidence). Account, profile, credential, role and consents are one transaction.
 */
export class RegisterCustomer {
  constructor(private readonly deps: SignupDeps) {}

  async execute(input: SignupInput, req: Request, requestId: string): Promise<{ userId: string }> {
    const { deps } = this;
    await deps.limiter.hit(`signup:${await deps.limiter.clientKey(req)}`, SIGNUP_LIMIT.limit, SIGNUP_LIMIT.windowSec);

    const email = input.email.trim().toLowerCase();
    const name = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
    const problems = passwordProblems(input.password, { email, name });
    if (problems.length) throw new ValidationError("weak_password", problems[0]!, { fieldErrors: { password: problems } });
    const phone = input.phone?.trim() ? await deps.geo.phone("phone", input.phone, input.phoneCountry) : null;
    if (await deps.customers.emailExists(email)) throw CustomerErrors.emailTaken();

    const id = deps.ids.newId();
    const now = deps.clock.nowIso();
    const { consentVersion } = await deps.legal.execute();
    const consent = (purpose: string, granted: boolean) =>
      deps.customers.consentStatement({ id: deps.ids.newId(), userId: id, purpose, version: consentVersion, granted, now });
    await new UnitOfWork(deps.db)
      .add(deps.customers.insertUserStatement({ id, email, displayName: name, phone, now }))
      .add(deps.customers.upsertProfileStatement(id, { firstName: input.firstName.trim(), lastName: input.lastName.trim(), companyName: null, notes: null }, now))
      .add(deps.credentials.setPasswordStatement(id, await deps.passwords.hash(input.password), now))
      .add(deps.customers.assignCustomerRoleStatement(id))
      .add(consent("kvkk_notice", true), consent("marketing_email", input.marketingEmail), consent("marketing_sms", input.marketingSms))
      .add(deps.audit.recordStatement({ actor: { userId: id, requestId }, action: "customer.signup", entityType: "user", entityId: id, diff: { marketingEmail: input.marketingEmail, marketingSms: input.marketingSms } }))
      .commit();
    return { userId: id };
  }
}
