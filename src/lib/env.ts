import "server-only"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

let loaded = false

function resolveEnvFile(file?: string): string {
	if (file) return file
	if (process.env.ENV_FILE) return process.env.ENV_FILE
	const mode = (process.env.D1_MODE || "local").toLowerCase()
	return mode === "remote" ? ".env" : ".env.local"
}

function loadDotEnv(file?: string): void {
	if (loaded) return
	loaded = true

	const path = resolve(process.cwd(), resolveEnvFile(file))
	if (!existsSync(path)) return

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

		if (process.env[key] === undefined) process.env[key] = value
	}
}

export function env(): NodeJS.ProcessEnv {
	loadDotEnv()
	return process.env
}

export function requireEnvString(key: string): string {
	const value = env()[key]
	if (!value) throw new Error(`Missing env: ${key}`)
	return value
}
