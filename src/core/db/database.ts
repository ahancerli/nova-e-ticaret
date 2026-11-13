/**
 * Database port. Application code depends on this interface, never on the SQLite driver directly,
 * so repositories can be exercised against an in-memory database (tests) or the data/nova.db file (server).
 *
 * Rules (db/README.md §1):
 *  - Always bind parameters (`?`); never interpolate input into SQL. Column / ORDER BY names come from allowlists.
 *  - Max 100 bound parameters per statement → use `placeholders()` and chunk IN lists.
 *  - Multi-statement writes go through a UnitOfWork (one batch = one transaction).
 */
export type Statement = SqlStatement;

export interface RunResult {
  changes: number;
  lastRowId: number | null;
}

export interface Database {
  /** A bound statement for use in a UnitOfWork / batch. */
  statement(sql: string, ...params: unknown[]): Statement;
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  first<T>(sql: string, ...params: unknown[]): Promise<T | null>;
  run(sql: string, ...params: unknown[]): Promise<RunResult>;
  /** Runs statements as one transaction; the first error (incl. trigger RAISE) rolls back all of them. */
  batch(statements: Statement[]): Promise<SqlResult[]>;
}

export const MAX_BOUND_PARAMS = 100;
export const MAX_IN_LIST = 90;

/** `?,?,?` for an IN list of `n` values (1..MAX_IN_LIST). */
export function placeholders(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > MAX_IN_LIST) throw new RangeError(`placeholder count out of range: ${n}`);
  return Array.from({ length: n }, () => "?").join(",");
}

/** Splits a list into IN-list sized chunks. */
export function chunk<T>(items: readonly T[], size = 80): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Adapter: SQL driver (src/server/sqlite-driver.ts) → Database port. */
export class SqlDatabaseAdapter implements Database {
  constructor(private readonly driver: SqlDriver) {}

  statement(sql: string, ...params: unknown[]): Statement {
    const stmt = this.driver.prepare(sql);
    return params.length ? stmt.bind(...params) : stmt;
  }

  async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    const { results } = await this.statement(sql, ...params).all<T>();
    return results ?? [];
  }

  async first<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    return (await this.statement(sql, ...params).first<T>()) ?? null;
  }

  async run(sql: string, ...params: unknown[]): Promise<RunResult> {
    const { meta } = await this.statement(sql, ...params).run();
    return { changes: meta.changes ?? 0, lastRowId: meta.last_row_id ?? null };
  }

  batch(statements: Statement[]): Promise<SqlResult[]> {
    return this.driver.batch(statements);
  }
}
