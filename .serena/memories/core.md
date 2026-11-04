# nova — core map
Single-seller e-commerce: storefront (`/`) + admin panel (`/admin`) in one Next.js 16 app on Cloudflare Workers (OpenNext), D1 (SQLite) + R2.
Code/identifiers English; UI text, Zod messages, docs Turkish. Money = INTEGER kuruş, VAT-inclusive (`*_minor`).

Authoritative docs (read the relevant section instead of rediscovering): `README.md` §3 folder map, §4 architecture rules (1–14), §4.1 core/route, §4.2 module layout, §4.3 frontend/errors, §5 module status, §6 admin UI kit, §7 flows (checkout, order state machine, outbox, shipping, media), §8 API table, §10 known pitfalls. `db/README.md`: data rules, triggers→error codes, status machines, audit/permission dictionaries. `db/schema.sql` = single DDL source (93 STRICT tables; table-count assert in `db/tests/test_schema.py`).

## Source map
- `src/core/` framework-free base (errors, di, db/UnitOfWork, http/router, logging, runtime, security). Never imports server/modules.
- `src/server/app.ts` composition root: DI registrations, `route`, `resolveService`, `currentPrincipal`, `requireAdminPage`. `env.ts` bindings + local env. `src/server/graphql/` read-only storefront graph (SDL `schema.ts` + `rootValue` → storefront query services; `execute.ts` depth/token limits), served by `src/app/api/graphql/route.ts` inside `route()`.
- `src/modules/<m>/` business modules (domain/application/infrastructure/http/module.ts/index.ts); public surface = `index.ts` only.
- `src/modules/integrations/` third-party firms (SMS / cargo): catalog = `integration_providers` table (upserted at the end of `db/schema.sql`), adapters in `infrastructure/connectors/` (`defaultConnectors()`), `IntegrationRuntime` port used by shipping (booking + `/api/cron/shipping-sync`) and notifications (order SMS). A firm is selectable only if catalog row is `ready` AND a connector exists.
- `src/features/shop/` storefront micro-frontend (SSR layout/home, listing, product, shared `ui/` card/price/grid/rail, `data/graph.ts` GraphQL client); `(storefront)` routes import only `@/features/shop` (server entry).
- `src/features/<area>/` client screens + `api.ts` (typed fetchers); `src/components/{ui,admin}` shared UI w/o business logic; `src/lib/` isomorphic helpers (`api-client`, `order-rules`, `product-rules`, `money`, `toast`).
- `src/app/` route groups: `(storefront)`, `(admin)/admin`, `(admin-auth)`, `(admin-print)`, `api/` (JSON route handlers), `assets/[...path]` (R2).
- `src/proxy.ts` per-request CSP nonce. `tests/{unit,integration,e2e}`.

## Further memories
- language/framework versions, runtime constraints: `mem:tech_stack`
- coding patterns (use case, UnitOfWork guards, route(), DI tokens, client/server import split, UI text rules): `mem:conventions`
- dev/db/test/deploy commands and Darwin specifics: `mem:suggested_commands`
- definition-of-done checks: `mem:task_completion`
- repo hazards (iCloud duplicate files, local D1 corruption, stale dev modules): `mem:pitfalls`
