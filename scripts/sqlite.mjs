// Opens the app database for scripts with the same pragmas as the server (src/server/sqlite-driver.ts).
import { existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { DatabaseSync } from "node:sqlite"

export function openDatabase(path) {
	mkdirSync(dirname(path), { recursive: true })
	const db = new DatabaseSync(path)
	db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;")
	return db
}

export const databaseExists = (path) => existsSync(path)

/** True when the core schema is present (used to decide whether a fresh database needs the seed). */
export const hasSchema = (db) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get())
