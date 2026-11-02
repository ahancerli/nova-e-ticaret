import type { Statement } from "@/core";
import type { CustomerDetail, CustomerList, CustomerQuery } from "../domain/customer";

export interface CustomerRepository {
  list(q: CustomerQuery): Promise<CustomerList>;
  find(id: string, now: string): Promise<CustomerDetail | null>;
  emailExists(emailNormalized: string): Promise<boolean>;
  /** A member account (never a staff account). */
  isCustomer(id: string): Promise<boolean>;
  insertUserStatement(u: { id: string; email: string; displayName: string; phone: string | null; now: string }): Statement;
  upsertProfileStatement(userId: string, p: { firstName: string; lastName: string; companyName: string | null; notes: string | null }, now: string): Statement;
  updateUserStatement(id: string, u: { displayName: string; phone: string | null }, now: string): Statement;
  assignCustomerRoleStatement(userId: string): Statement;
  setStatusStatement(id: string, status: "active" | "suspended", now: string): Statement;
  consentStatement(c: { id: string; userId: string; purpose: string; version: string; granted: boolean; now: string }): Statement;
}
