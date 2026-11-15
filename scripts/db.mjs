// Database tool for the SQLite file (DATABASE_PATH, default data/nova.db). Reads .env.local unless ENV_FILE is set;
// inside Docker the container environment is used.
//   node scripts/db.mjs init                      schema (+ seed when the database is new) + migrations — run on every container start
//   node scripts/db.mjs schema | seed | migrate   apply db/schema.sql / db/seed.sql / pending db/migrations/*.sql
//   node scripts/db.mjs reset [--yes]             drop everything, schema + seed (asks for --yes when APP_ENV=production)
//   node scripts/db.mjs exec --file=path.sql      run a SQL file
//   node scripts/db.mjs exec --command "SQL"      run one statement; SELECT prints a table
//   node scripts/db.mjs import dump.sql [--force] load a SQL dump (e.g. `wrangler d1 export`) into a NEW database, then schema + migrations
//   node scripts/db.mjs backup [out.db]           online copy (default: <data dir>/backups/nova-<time>.db, keeps BACKUP_KEEP = 14)
//   node scripts/db.mjs check                     compare the database with db/schema.sql + migrations; exit 1 on drift
//
// Migrations: every db/migrations file starts with  -- probe: SELECT new_column FROM some_table LIMIT 0
// The probe succeeds only after the migration ran, so a file is applied exactly once and re-running is safe.
// A file with the line  -- foreign_keys: off  runs with foreign keys off (table rebuilds) and is FK-checked before COMMIT.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { DatabaseSync, backup } from "node:sqlite"
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
		// Table rebuilds (create new, copy, drop, rename) need foreign keys off: a RESTRICT child would block the DROP.
		// The pragma is a no-op inside a transaction, so it is switched around it and checked before COMMIT.
		const fkOff = /^--\s*foreign_keys:\s*off\s*$/m.test(sql)
		if (fkOff) db.exec("PRAGMA foreign_keys = OFF")
		db.exec("BEGIN IMMEDIATE")
		try {
			db.exec(sql)
			if (fkOff) {
				const broken = db.prepare("PRAGMA foreign_key_check").all()
				if (broken.length) throw new Error(`foreign key check failed: ${JSON.stringify(broken.slice(0, 5))}`)
			}
			db.exec("COMMIT")
		} catch (e) {
			db.exec("ROLLBACK")
			fail(`${f} failed: ${e.message}`)
		} finally {
			if (fkOff) db.exec("PRAGMA foreign_keys = ON")
		}
		applied++
	}
	console.log(`✓ migrations: ${applied} applied, ${files.length - applied} already present`)
}

// Drift report: pending migrations (probe fails), tables/indexes/triggers/views or columns from db/schema.sql the
// database lacks, and objects/columns the database has that the schema does not. Column order is ignored (ALTER appends).
function drift(db) {
	const pending = readdirSync("db/migrations")
		.filter((f) => f.endsWith(".sql"))
		.sort()
		.filter((f) => {
			const probe = /^--\s*probe:\s*(.+)$/m.exec(read(`db/migrations/${f}`))?.[1]?.trim()
			try {
				db.prepare(probe).all()
				return false
			} catch {
				return true
			}
		})
	const ref = new DatabaseSync(":memory:")
	ref.exec(read("db/schema.sql"))
	const objects = (d) =>
		new Set(
			d
				.prepare("SELECT type || ' ' || name AS k FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'")
				.all()
				.map((r) => r.k),
		)
	const want = objects(ref)
	const have = objects(db)
	const missing = [...want].filter((k) => !have.has(k))
	const extra = [...have].filter((k) => !want.has(k))
	const columns = (d, t) => new Set(d.prepare("SELECT name FROM pragma_table_info(?)").all(t).map((r) => r.name))
	for (const k of want) {
		if (!k.startsWith("table ") || !have.has(k)) continue
		const t = k.slice(6)
		const a = columns(db, t)
		const b = columns(ref, t)
		for (const c of b) if (!a.has(c)) missing.push(`column ${t}.${c}`)
		for (const c of a) if (!b.has(c)) extra.push(`column ${t}.${c}`)
	}
	ref.close()
	return { pending, missing, extra }
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
	case "check": {
		if (!databaseExists(path)) fail(`no database at ${path} — run npm run db:setup`)
		const db = openDatabase(path)
		const { pending, missing, extra } = drift(db)
		db.close()
		if (!pending.length && !missing.length && !extra.length) {
			console.log(`✓ in sync with db/schema.sql + migrations: ${path}`)
			break
		}
		if (pending.length) console.log(`pending migrations: ${pending.join(", ")}`)
		if (missing.length) console.log(`missing in database: ${missing.join(", ")}`)
		if (extra.length) console.log(`not in schema: ${extra.join(", ")}`)
		process.exit(1)
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
		fail("usage: node scripts/db.mjs <init|check|schema|seed|migrate|reset|exec|import|backup> …")
}
