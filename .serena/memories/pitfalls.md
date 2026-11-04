# Pitfalls
- iCloud duplicates: project lives on iCloud-synced Desktop; files like `page 2.tsx`, `api 2.ts`, `module 2.ts`, `* 2.test.ts` appear (≈70 committed in git as of 2026-11). They are stale copies — never edit/import them; search results may show both. `tsconfig` only ignores `.next/**/* ?.ts`.
- Don't write to local D1 (`db:*:local`, `wrangler d1 execute --local`) while `npm run dev` runs → SQLite corruption (`database disk image is malformed`). Stop dev first.
- `wrangler.jsonc` `vars` (APP_ENV, PUBLIC_SITE_URL) leak into local dev; `.env.local` values take precedence (`buildConfig`). Production without SESSION_SECRET/SECRETS_MASTER_KEY/CRON_SECRET → `ConfigError` at startup.
- SQLite ≥3.51: correlated subquery `ORDER BY` can't reference outer columns; keep outer refs in `WHERE`.
- `schema.sql` is `CREATE TABLE IF NOT EXISTS` → column changes don't apply to existing DBs.
- No email provider: invite/reset links shown once to admin.
- iyzico refund endpoint & webhook V3 signature not sandbox-verified. `buy_x_get_y` exists in schema but not offered in panel. Date filters use UTC day bounds in places (display Europe/Istanbul).
- Seed `admin@nova.local` password undocumented → use `admin:create:local`.
