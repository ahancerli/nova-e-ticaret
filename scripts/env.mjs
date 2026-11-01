// Minimal .env loader (no dependency). Real environment variables win over the file.
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

export function resolveEnvFile(file) {
	if (file) return file
	if (process.env.ENV_FILE) return process.env.ENV_FILE
	const mode = (process.env.D1_MODE || "local").toLowerCase()
	return mode === "remote" ? ".env" : ".env.local"
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
