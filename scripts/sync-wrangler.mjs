// Writes D1 target fields from the selected env file into wrangler.jsonc.
// local mode reads .env.local, remote mode reads .env (unless ENV_FILE overrides).
import { readFileSync, writeFileSync } from "node:fs"
import { loadEnv } from "./env.mjs"

loadEnv()
const mode = (process.env.D1_MODE || "local").toLowerCase()
const remote = mode === "remote"
const name = remote
	? process.env.CLOUDFLARE_D1_REMOTE_DATABASE_NAME || process.env.CLOUDFLARE_D1_DATABASE_NAME
	: process.env.CLOUDFLARE_D1_LOCAL_DATABASE_NAME ||
		process.env.CLOUDFLARE_D1_DATABASE_NAME ||
		"nova-local"
const id = remote
	? process.env.CLOUDFLARE_D1_REMOTE_DATABASE_ID || process.env.CLOUDFLARE_D1_DATABASE_ID
	: process.env.CLOUDFLARE_D1_LOCAL_DATABASE_ID ||
		process.env.CLOUDFLARE_D1_DATABASE_ID ||
		"11111111-1111-1111-1111-111111111111"

if (!id) {
	console.warn("⚠ D1 database id is empty — wrangler.jsonc left unchanged.")
	process.exit(0)
}
if (!/^[0-9a-f-]{36}$/i.test(id)) {
	console.error("✖ D1 database id does not look like a UUID.")
	process.exit(1)
}

const file = "wrangler.jsonc"
const src = readFileSync(file, "utf8")
const block =
	/("binding"\s*:\s*"DB"[\s\S]*?"database_name"\s*:\s*")([^"]*)("[\s\S]*?"database_id"\s*:\s*")([^"]*)("[\s\S]*?"remote"\s*:\s*)(true|false)/
if (!block.test(src)) {
	console.error("✖ Could not find the DB binding block in wrangler.jsonc")
	process.exit(1)
}
const next = src.replace(
	block,
	(_m, a, oldName, b, _oldId, c) =>
		`${a}${name || oldName}${b}${id}${c}${String(remote)}`,
)
const servicesBlock = /"services"\s*:\s*\[[\s\S]*?\],/
const servicesValue = remote
	? '"services": [{ "binding": "WORKER_SELF_REFERENCE", "service": "nova-commerce" }],'
	: '"services": [],'
const finalConfig = servicesBlock.test(next) ? next.replace(servicesBlock, servicesValue) : next

if (finalConfig !== src) {
	writeFileSync(file, finalConfig)
	console.log(`✔ wrangler.jsonc → D1 ${name} (${id}), remote=${remote}`)
}
