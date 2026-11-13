// Runtime bindings + secrets of the Node server (src/server/env.ts builds them from process.env).
// Keep in sync with .env.example and docker-compose*.yml.
//
// The SQL surface is the small D1-style API the Database port (src/core/db/database.ts) is written against:
// prepare → bind → all / first / run, and batch = one transaction. src/server/sqlite-driver.ts implements it
// over node:sqlite.

interface SqlMeta {
  changes?: number;
  last_row_id?: number;
}

interface SqlResult<T = unknown> {
  results: T[];
  success: boolean;
  meta: SqlMeta;
}

interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
}

interface SqlDriver {
  prepare(query: string): SqlStatement;
  batch<T = unknown>(statements: SqlStatement[]): Promise<SqlResult<T>[]>;
}

interface RuntimeEnv {
  DB: SqlDriver;
  /** Uploaded media (MEDIA_DIR on disk). Missing → uploads report "storage not configured". */
  MEDIA_STORAGE?: import("./src/modules/media/application/ports").ObjectStorage;
  APP_ENV: "development" | "production";
  PUBLIC_SITE_URL: string;
  SESSION_SECRET: string;
  SECRETS_MASTER_KEY: string;
  SECRETS_KEY_VERSION: string;
  CRON_SECRET: string;
}
