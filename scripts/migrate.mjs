// Applies db/migrations/*.sql that a database does not have yet, in file-name order.
//   D1_MODE=local  node scripts/migrate.mjs     (npm run db:migrate:local)
//   D1_MODE=remote node scripts/migrate.mjs     (npm run db:migrate:remote)
// Every migration starts with a probe line:  -- probe: SELECT new_column FROM some_table LIMIT 0
// The probe succeeds only after the migration ran, so a file is applied exactly once and re-running is safe.
// Run after `db:schema:*` (which creates new tables and is itself re-runnable).
import { spawnSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { loadEnv } from "./env.mjs"

loadEnv()
const d1 = (args) => spawnSync("node", ["scripts/d1.mjs", "execute", ...args], { env: process.env, encoding: "utf8", shell: process.platform === "win32" })

const files = readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).sort()
let applied = 0
for (const f of files) {
	const sql = readFileSync(`db/migrations/${f}`, "utf8")
	const probe = /^--\s*probe:\s*(.+)$/m.exec(sql)?.[1]?.trim()
	if (!probe) {
		console.error(`✘ ${f}: missing "-- probe: <SQL>" line`)
		process.exit(1)
	}
	if (d1(["--command", probe]).status === 0) {
		console.log(`· ${f} already applied`)
		continue
	}
	console.log(`→ applying ${f}`)
	const r = d1([`--file=db/migrations/${f}`])
	if (r.status !== 0) {
		console.error(r.stdout, r.stderr)
		console.error(`✘ ${f} failed`)
		process.exit(1)
	}
	applied++
}
console.log(`migrations: ${applied} applied, ${files.length - applied} already present`)
