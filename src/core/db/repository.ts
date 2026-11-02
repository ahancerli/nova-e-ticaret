import type { Database } from "./database";
import { UnitOfWork } from "./unit-of-work";

/**
 * Base class for repositories: the only layer that writes SQL.
 * A repository maps rows ↔ domain objects for one aggregate (e.g. Category, Order) and exposes
 * intention-revealing methods (`findBySlug`, `insertStatement`) — never raw SQL to its callers.
 *
 * Read methods execute immediately. Write methods that may take part in a larger transaction return
 * `Statement`s (named `…Statement`) so the application service can put several aggregates' changes
 * into one UnitOfWork.
 */
export abstract class Repository {
  constructor(protected readonly db: Database) {}

  /** A fresh unit of work on the same database (for single-repository atomic writes). */
  protected unitOfWork(): UnitOfWork {
    return new UnitOfWork(this.db);
  }
}

/** SQLite 0/1 → boolean. */
export const bool = (v: number | null | undefined): boolean => v === 1;
/** boolean → SQLite 0/1. */
export const bit = (v: boolean): 0 | 1 => (v ? 1 : 0);
