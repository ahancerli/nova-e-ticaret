import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

/**
 * Opens the SQLite file with the pragmas the app relies on: foreign keys ON (FK RESTRICT rules in schema.sql),
 * WAL (readers never block the writer; CLI scripts can run next to the server) and a busy timeout for those scripts.
 */
export function openSqlite(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return db;
}

const RETURNING = /\bRETURNING\b/i;
const STATEMENT_CACHE_LIMIT = 500;

const toParam = (v: unknown): SQLInputValue => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : (v as SQLInputValue));
// node:sqlite rows have a null prototype; plain objects keep JSON / spread / equality checks predictable
const plain = (row: Record<string, SQLInputValue>): Record<string, unknown> => ({ ...row });

class SqliteStatement implements SqlStatement {
  constructor(private readonly driver: SqliteDriver, readonly sql: string, readonly params: SQLInputValue[] = []) {}

  bind(...values: unknown[]): SqlStatement {
    return new SqliteStatement(this.driver, this.sql, values.map(toParam));
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const row = this.driver.statement(this.sql).get(...this.params) as Record<string, SQLInputValue> | undefined;
    if (!row) return null;
    return (colName ? row[colName] : plain(row)) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    return this.driver.execute(this) as SqlResult<T>;
  }

  async run<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    return this.driver.execute(this) as SqlResult<T>;
  }
}

/**
 * SqlDriver over node:sqlite — one connection per process. node:sqlite is synchronous, so a batch runs
 * BEGIN … COMMIT without yielding to the event loop: no other request can interleave statements with it, and the
 * UnitOfWork guards (`changes()` right after the guarded statement) see exactly that statement's effect.
 */
export class SqliteDriver implements SqlDriver {
  private readonly cache = new Map<string, StatementSync>();

  constructor(readonly raw: DatabaseSync) {}

  prepare(query: string): SqlStatement {
    return new SqliteStatement(this, query);
  }

  async batch<T = unknown>(statements: SqlStatement[]): Promise<SqlResult<T>[]> {
    const own = statements.map((s) => {
      if (!(s instanceof SqliteStatement)) throw new TypeError("batch() takes statements of this driver only");
      return s;
    });
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results = own.map((s) => this.execute(s));
      this.raw.exec("COMMIT");
      return results as SqlResult<T>[];
    } catch (err) {
      if (this.raw.isTransaction) this.raw.exec("ROLLBACK");
      throw err;
    }
  }

  /** @internal Prepared statements are reused by SQL text (SQLite re-prepares them itself after schema changes). */
  statement(sql: string): StatementSync {
    let st = this.cache.get(sql);
    if (!st) {
      if (this.cache.size >= STATEMENT_CACHE_LIMIT) this.cache.clear();
      st = this.raw.prepare(sql);
      this.cache.set(sql, st);
    }
    return st;
  }

  /** @internal */
  execute(s: SqliteStatement): SqlResult {
    const st = this.statement(s.sql);
    if (st.columns().length === 0) {
      const r = st.run(...s.params);
      return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
    const results = (st.all(...s.params) as Record<string, SQLInputValue>[]).map(plain);
    // INSERT/UPDATE/DELETE … RETURNING yields one row per changed row
    return { results, success: true, meta: { changes: RETURNING.test(s.sql) ? results.length : 0 } };
  }
}
