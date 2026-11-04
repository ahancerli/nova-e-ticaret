# Suggested commands
- Dev: `npm run dev` (local D1, http://localhost:3000, panel /admin, login /admin/giris); `npm run dev:remote` (Cloudflare D1). `predev` syncs wrangler.jsonc.
- DB local: `npm run db:schema:local`, `db:seed:local`, `db:reset:local`, `npm run db:query:local -- "SQL"`. Remote variants without `:local` / with `:remote` (touch production — confirm first).
- Admin user: `npm run admin:create:local -- email@x "Ad Soyad"` (prompts password ≥12).
- Checks: `npm run typecheck`, `npm run lint`, `npm test` (all suites), single suite `npm run test:<catalog|orders|identity|storefront|integrations|reporting|content|accounts|campaigns|showcase|audit|ai|services|core>`, `npm run db:test`, `npm run test:e2e` (first time `npx playwright install chromium`).
- Deploy (production, ask first): `npm run preview` / `deploy` / `upload`.
## Darwin notes
- BSD `sed -i ''` (not `sed -i`); `find` paths with spaces (iCloud dupes like `form-values 2.ts`) need quoting.
- Node via nvm (`nvm alias default node`); `uv`/`serena`/`claude` in `~/.local/bin` (PATH set in `~/.zshenv`).
