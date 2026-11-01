// Bindings + secrets available via getCloudflareContext().env.
// Keep in sync with wrangler.jsonc and .dev.vars.example.
//
// Minimal D1/Fetcher typings are declared here on purpose instead of pulling
// @cloudflare/workers-types globally: its globals clash with the DOM lib that
// Next.js client components need. Only the surface this app uses is typed.

interface D1Meta {
  changes?: number;
  last_row_id?: number;
  duration?: number;
  rows_read?: number;
  rows_written?: number;
}

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface CloudflareEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  WORKER_SELF_REFERENCE: Fetcher;
  APP_ENV: "development" | "production";
  PUBLIC_SITE_URL: string;
  SESSION_SECRET: string;
  SECRETS_MASTER_KEY: string;
  SECRETS_KEY_VERSION: string;
  CRON_SECRET: string;
  ADMIN_MFA_ENFORCED?: string;
}
