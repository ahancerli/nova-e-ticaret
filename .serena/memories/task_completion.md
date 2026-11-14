# Task completion
Run, in order, and keep all clean (lint and build must be error- AND warning-free):
1. `npm run typecheck`
2. `npm run lint`
3. Affected suite(s): `npm run test:<module>`; for cross-cutting changes `npm test`. UI flow changes covered by e2e → `npm run test:e2e`.
4. If `db/schema.sql` changed: `npm run db:test`; column additions for existing DBs go in a probe-guarded `db/migrations/*.sql` (applied by `db:setup` / container start).
- New module/route/state-machine action → add/extend `tests/integration/<module>.test.ts`.
- Behavior/architecture changes → update the matching `README.md` section (it is the human handover doc, Turkish).
- `npm run build` only after asking (it breaks a running dev server).
- If `next dev` serves stale shared server modules after editing `http/schemas.ts` / `server/app.ts`, restart it.
