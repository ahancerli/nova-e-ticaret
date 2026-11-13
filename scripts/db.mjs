// Database tool for the SQLite file (DATABASE_PATH, default data/nova.db). Reads .env.local unless ENV_FILE is set;
// inside Docker the container environment is used.
//   node scripts/db.mjs init                      schema (+ seed when the database is new) + migrations — run on every container start
//   node scripts/db.mjs schema | seed | migrate   apply db/schema.sql / db/seed.sql / pending db/migrations/*.sql
//   node scripts/db.mjs reset [--yes]             drop everything, schema + seed (asks for --yes when APP_ENV=production)
//   node scripts/db.mjs exec --file=path.sql      run a SQL file
//   node scripts/db.mjs exec --command "SQL"      run one statement; SELECT prints a table
//   node scripts/db.mjs import dump.sql [--force] load a SQL dump (e.g. `wrangler d1 export`) into a NEW database, then schema + migrations
//   node scripts/db.mjs backup [out.db]           online copy (default: <data dir>/backups/nova-<time>.db, keeps BACKUP_KEEP = 14)
//
// Migrations: every db/migrations file starts with  -- probe: SELECT new_column FROM some_table LIMIT 0
// The probe succeeds only after the migration ran, so a file is applied exactly once and re-running is safe.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { backup } from "node:sqlite"
import { databasePath, loadEnv } from "./env.mjs"
import { databaseExists, hasSchema, openDatabase } from "./sqlite.mjs"

loadEnv()
const path = databasePath()
const [action, ...args] = process.argv.slice(2)
const flag = (name) => args.includes(name)
const read = (file) => readFileSync(file, "utf8")

function fail(message) {
	console.error(`✖ ${message}`)
	process.exit(1)
}

function applySchema(db) {
	db.exec(read("db/schema.sql"))
	console.log("✓ schema (db/schema.sql)")
}

function applySeed(db) {
	db.exec(read("db/seed.sql"))
	console.log("✓ seed (db/seed.sql)")
}

function migrate(db) {
	const files = readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).sort()
	let applied = 0
	for (const f of files) {
		const sql = read(`db/migrations/${f}`)
		const probe = /^--\s*probe:\s*(.+)$/m.exec(sql)?.[1]?.trim()
		if (!probe) fail(`${f}: missing "-- probe: <SQL>" line`)
		try {
			db.prepare(probe).all()
			continue
		} catch {
			// probe failed → not applied yet
		}
		console.log(`→ applying ${f}`)
		db.exec("BEGIN IMMEDIATE")
		try {
			db.exec(sql)
			db.exec("COMMIT")
		} catch (e) {
			db.exec("ROLLBACK")
			fail(`${f} failed: ${e.message}`)
		}
		applied++
	}
	console.log(`✓ migrations: ${applied} applied, ${files.length - applied} already present`)
}

function execCommand(db, sql) {
	if (/;\s*\S/.test(sql.trim())) {
		db.exec(sql)
		console.log("✓ executed")
		return
	}
	const st = db.prepare(sql)
	if (st.columns().length) console.table(st.all())
	else console.log(`✓ ${st.run().changes} row(s) changed`)
}

function backupTarget() {
	const explicit = args.find((a) => !a.startsWith("--"))
	if (explicit) return explicit
	const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)
	return join(dirname(path), "backups", `nova-${stamp}.db`)
}

function pruneBackups(dir) {
	const keep = Number(process.env.BACKUP_KEEP || 14)
	const files = readdirSync(dir)
		.filter((f) => /^nova-\d{8}-\d{6}\.db$/.test(f))
		.map((f) => join(dir, f))
		.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
	for (const old of files.slice(keep)) rmSync(old)
}

switch (action) {
	case "init": {
		const db = openDatabase(path)
		const fresh = !hasSchema(db)
		applySchema(db)
		if (fresh && process.env.SEED_ON_INIT !== "false") applySeed(db)
		migrate(db)
		db.close()
		console.log(`✓ database ready: ${path}${fresh ? " (new)" : ""}`)
		break
	}
	case "schema":
	case "seed":
	case "migrate": {
		const db = openDatabase(path)
		;({ schema: applySchema, seed: applySeed, migrate })[action](db)
		db.close()
		break
	}
	case "reset": {
		if (process.env.APP_ENV === "production" && !flag("--yes")) fail("APP_ENV=production: add --yes to wipe the database")
		const db = openDatabase(path)
		db.exec(read("db/drop_all.sql"))
		applySchema(db)
		applySeed(db)
		db.close()
		break
	}
	case "exec": {
		const file = args.find((a) => a.startsWith("--file="))?.slice("--file=".length)
		const i = args.indexOf("--command")
		const command = i >= 0 ? args.slice(i + 1).join(" ") : ""
		if (!file && !command) fail('usage: node scripts/db.mjs exec --file=path.sql | --command "SQL"')
		const db = openDatabase(path)
		if (file) {
			db.exec(read(file))
			console.log(`✓ ${file}`)
		} else execCommand(db, command)
		db.close()
		break
	}
	case "import": {
		const dump = args.find((a) => !a.startsWith("--"))
		if (!dump) fail("usage: node scripts/db.mjs import dump.sql [--force]")
		if (databaseExists(path)) {
			if (!flag("--force")) fail(`${path} already exists — move it away or add --force to replace it`)
			for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true })
		}
		const db = openDatabase(path)
		db.exec("PRAGMA foreign_keys = OFF")
		db.exec("BEGIN")
		try {
			db.exec(read(dump))
			db.exec("COMMIT")
		} catch (e) {
			db.exec("ROLLBACK")
			fail(`import failed: ${e.message}`)
		}
		for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '\\_cf\\_%' ESCAPE '\\'").all()) {
			db.exec(`DROP TABLE "${name}"`)
		}
		db.exec("PRAGMA foreign_keys = ON")
		applySchema(db)
		migrate(db)
		const broken = db.prepare("PRAGMA foreign_key_check").all().length
		db.close()
		console.log(`✓ imported ${basename(dump)} → ${path}${broken ? ` (⚠ ${broken} foreign key violations)` : ""}`)
		break
	}
	case "backup": {
		if (!databaseExists(path)) fail(`${path} does not exist`)
		const out = backupTarget()
		mkdirSync(dirname(out), { recursive: true })
		const db = openDatabase(path)
		await backup(db, out)
		db.close()
		if (!args.some((a) => !a.startsWith("--"))) pruneBackups(dirname(out))
		console.log(`✓ backup → ${out}`)
		break
	}
	default:
		fail("usage: node scripts/db.mjs <init|schema|seed|migrate|reset|exec|import|backup> …")
}
