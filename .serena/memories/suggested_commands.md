# Suggested commands
- Dev (no Docker): `npm run dev` (`data/nova.db` + `data/uploads` from `.env.local`, http://localhost:3000, panel /admin, login /admin/giris). `npm run scheduler` calls `/api/cron/*` on intervals (optional).
- Dev (Docker, prod-like): `docker compose up -d --build` (app + scheduler + kafka + kafka-rest; override file binds `./data` and port 3000 — never run together with `npm run dev`), `docker compose logs -f app scheduler`, `docker compose exec app node scripts/<x>.mjs`. Kafka for `npm run dev`: `docker compose up -d kafka kafka-rest` + `INTEGRATION_BUS=kafka KAFKA_REST_URL=http://localhost:8082`.
- DB (`scripts/db.mjs`, target `DATABASE_PATH`): `npm run db:setup` (schema + seed if new + migrations; container entrypoint runs it every start), `db:schema` / `db:seed` / `db:migrate` / `db:reset`, `npm run db:query -- "SQL"`, `db:import -- dump.sql [--force]` (SQL dump into a NEW DB, drops `_cf_*`), `db:backup`.
- Admin user: `npm run admin:create -- email@x "Ad Soyad"` (prompts password ≥12; container: `docker compose exec app node scripts/create-admin.mjs …`).
- Checks: `npm run typecheck`, `npm run lint`, `npm test` (all suites), single suite `npm run test:<runtime|reviews|marketplaces|bulk|catalog|orders|identity|storefront|integrations|reporting|content|accounts|campaigns|showcase|audit|ai|mail|payments|providers|services|core>`, `npm run db:test`, `npm run test:e2e` (first time `npx playwright install chromium`). `npm run build` must stay warning-free; check `.next/standalone` holds no `data/`/`src/`.
- AI providers with real keys (OPENAI_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY in env or .env.local): `npm run ai:health [-- --provider=x --model=y --generate]` — checks every `ai_models` row.
- Env files: `.env.local` (local + local Docker), `.env.production` (server; uploaded by deploy). Templates `.env.example`, `.env.production.example`.
- Deploy (production, ask first): `npm run deploy` (`deploy/deploy.sh`: rsync source + `.env.production` to `DEPLOY_HOST:/opt/nova`, `docker compose up -d --build` with prod files via server `.env` COMPOSE_FILE). One-time server prep `deploy/server-setup.sh`.
## Darwin notes
- BSD `sed -i ''` (not `sed -i`), no `\b` in BSD sed (use perl), no `timeout`; `find` paths with spaces (iCloud dupes like `form-values 2.ts`) need quoting.
- Node via nvm (`nvm alias default node`); `uv`/`serena`/`claude` in `~/.local/bin` (PATH set in `~/.zshenv`).
- Docker Desktop 4.17 (2023) does not start on this macOS — needs an update before local `docker compose`.
