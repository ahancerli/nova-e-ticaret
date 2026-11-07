# Suggested commands
- Dev: `npm run dev` (local D1, http://localhost:3000, panel /admin, login /admin/giris); `npm run dev:remote` (Cloudflare D1). `predev` syncs wrangler.jsonc.
- DB local: `npm run db:schema:local`, `db:seed:local`, `db:reset:local`, `npm run db:query:local -- "SQL"`, `db:migrate:local` (probe-guarded column migrations, re-runnable, after `db:schema:local`). Remote variants without `:local` / with `:remote` (touch production — confirm first).
- Admin user: `npm run admin:create:local -- email@x "Ad Soyad"` (prompts password ≥12).
- Checks: `npm run typecheck`, `npm run lint`, `npm test` (all suites), single suite `npm run test:<reviews|marketplaces|bulk|catalog|orders|identity|storefront|integrations|reporting|content|accounts|campaigns|showcase|audit|ai|services|core>`, `npm run db:test`, `npm run test:e2e` (first time `npx playwright install chromium`).
- AI providers with real keys (OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY in env or .env.local): `npm run ai:health [-- --provider=x --model=y --generate]` — checks every `ai_models` row.
- Integration bus env: `INTEGRATION_BUS=kafka|database` (default database), `KAFKA_REST_URL` (public HTTPS REST Proxy v2 in production), `KAFKA_REST_USERNAME/PASSWORD`, `KAFKA_TOPIC_PREFIX` (default nova). Cron: POST `/api/cron/integrations` every minute with `Bearer CRON_SECRET`.
- Deploy (production, ask first): `npm run preview` / `deploy` / `upload`.
## Darwin notes
- BSD `sed -i ''` (not `sed -i`); `find` paths with spaces (iCloud dupes like `form-values 2.ts`) need quoting.
- Node via nvm (`nvm alias default node`); `uv`/`serena`/`claude` in `~/.local/bin` (PATH set in `~/.zshenv`).
