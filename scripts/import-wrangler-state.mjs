// One-time move from the old Cloudflare local state (.wrangler/state/v3) to the Docker / Node layout:
//   local D1 SQLite file  → DATABASE_PATH (data/nova.db), then schema + migrations
//   local R2 objects      → MEDIA_DIR (data/uploads/<key> + <key>.meta.json, the FsObjectStorage format)
//   node scripts/import-wrangler-state.mjs [--force]      (npm run db:from-wrangler)
// The production D1 database is not touched; export it with `npx wrangler@4 d1 export … --remote` and use `db.mjs import`.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve, sep } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { spawnSync } from "node:child_process"
import { databasePath, loadEnv, mediaDir } from "./env.mjs"

loadEnv()
const STATE = ".wrangler/state/v3"
const force = process.argv.includes("--force")
const target = databasePath()
const media = mediaDir()

const sqliteFiles = (dir) =>
	existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite").map((f) => join(dir, f)) : []

const d1 = sqliteFiles(`${STATE}/d1/miniflare-D1DatabaseObject`)
if (d1.length !== 1) {
	console.error(`✖ expected one local D1 database in ${STATE}/d1, found ${d1.length}`)
	process.exit(1)
}
if (existsSync(target) && !force) {
	console.error(`✖ ${target} already exists — add --force to replace it`)
	process.exit(1)
}

// VACUUM INTO writes a consistent, compact copy (WAL content included) without touching the source
for (const suffix of ["", "-wal", "-shm"]) rmSync(target + suffix, { force: true })
mkdirSync(dirname(target), { recursive: true })
const src = new DatabaseSync(d1[0])
src.prepare("VACUUM INTO ?").run(target)
src.close()

const db = new DatabaseSync(target)
for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '\\_cf\\_%' ESCAPE '\\'").all()) {
	db.exec(`DROP TABLE "${name}"`)
}
const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get().n
db.close()
console.log(`✓ database: ${d1[0]} → ${target} (${tables} tables)`)

const init = spawnSync(process.execPath, ["scripts/db.mjs", "init"], { stdio: "inherit", env: process.env })
if (init.status !== 0) process.exit(init.status ?? 1)

const r2 = sqliteFiles(`${STATE}/r2/miniflare-R2BucketObject`)
let copied = 0
let missing = 0
for (const file of r2) {
	const meta = new DatabaseSync(file, { readOnly: true })
	for (const o of meta.prepare("SELECT key, blob_id, etag, http_metadata, custom_metadata FROM _mf_objects").all()) {
		const blob = existsSync(`${STATE}/r2`) ? readdirSync(`${STATE}/r2`).map((b) => join(STATE, "r2", b, "blobs", o.blob_id)).find(existsSync) : null
		const out = resolve(media, o.key)
		if (!blob || !out.startsWith(media + sep)) {
			missing++
			continue
		}
		mkdirSync(dirname(out), { recursive: true })
		copyFileSync(blob, out)
		const http = JSON.parse(o.http_metadata || "{}")
		writeFileSync(`${out}.meta.json`, JSON.stringify({ contentType: http.contentType || "application/octet-stream", etag: o.etag, metadata: JSON.parse(o.custom_metadata || "{}") }))
		copied++
	}
	meta.close()
}
console.log(`✓ media: ${copied} object(s) → ${media}${missing ? ` (⚠ ${missing} without a blob, skipped)` : ""}`)
