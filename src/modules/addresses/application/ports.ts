import type { Statement } from "@/core";
import type { AddressView } from "../domain/address";
import type { AddressInput } from "../http/schemas";

export interface AddressRepository {
  list(userId: string): Promise<AddressView[]>;
  find(userId: string, id: string): Promise<AddressView | null>;
  /** Inserted only while the customer has fewer than MAX_ADDRESSES (0 changes otherwise). */
  insertStatement(userId: string, id: string, a: AddressInput, now: string): Statement;
  updateStatement(userId: string, id: string, a: AddressInput, now: string): Statement;
  deleteStatement(userId: string, id: string): Statement;
  /** Clear the other default flags of the customer (run before setting a new default: unique index). */
  clearDefaultsStatement(userId: string, exceptId: string, shipping: boolean, billing: boolean): Statement;
  /** No default left (first address, or the default was deleted) → the newest address takes the role. */
  ensureDefaultsStatement(userId: string, now: string): Statement[];
}
