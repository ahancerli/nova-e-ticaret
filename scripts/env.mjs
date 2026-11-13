// Minimal .env loader (no dependency). Real environment variables win over the file, so inside Docker
// (env_file / environment) nothing is read from disk. Default file: .env.local, override with ENV_FILE.
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

export function resolveEnvFile(file) {
	return file || process.env.ENV_FILE || ".env.local"
}

export function loadEnv(file) {
	const selected = resolveEnvFile(file)
	const path = resolve(process.cwd(), selected)
	if (!existsSync(path)) return {}
	const out = {}
	for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || line.startsWith("#")) continue
		const eq = line.indexOf("=")
		if (eq < 1) continue
		const key = line.slice(0, eq).trim()
		let value = line.slice(eq + 1).trim()
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1)
		}
		out[key] = value
		if (process.env[key] === undefined) process.env[key] = value
	}
	return out
}

export function requireEnv(...keys) {
	const missing = keys.filter((k) => !process.env[k])
	if (missing.length) {
		const file = resolveEnvFile()
		console.error(`\n✖ Missing in ${file}: ${missing.join(", ")}\n`)
		process.exit(1)
	}
}

/** Absolute path of the SQLite file (DATABASE_PATH, default data/nova.db). */
export function databasePath() {
	return resolve(process.cwd(), process.env.DATABASE_PATH || "data/nova.db")
}

/** Absolute path of the uploaded media directory (MEDIA_DIR, default data/uploads). */
export function mediaDir() {
	return resolve(process.cwd(), process.env.MEDIA_DIR || "data/uploads")
}
