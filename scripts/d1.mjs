// Thin wrapper around `wrangler d1` that reads the target database from env files.
// local mode reads .env.local, remote mode reads .env (unless ENV_FILE overrides).
//   node scripts/d1.mjs create
//   node scripts/d1.mjs execute --file=db/schema.sql
//   node scripts/d1.mjs execute --command "SELECT count(*) FROM products"
import { spawnSync } from "node:child_process"
import { loadEnv, requireEnv } from "./env.mjs"

loadEnv()
const mode = (process.env.D1_MODE || "remote").toLowerCase()
const remote = mode === "remote"
const db = remote
	? process.env.CLOUDFLARE_D1_REMOTE_DATABASE_NAME || process.env.CLOUDFLARE_D1_DATABASE_NAME
	: process.env.CLOUDFLARE_D1_LOCAL_DATABASE_NAME ||
		process.env.CLOUDFLARE_D1_DATABASE_NAME ||
		"nova-local"

if (remote) requireEnv("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN")

const [action, ...rest] = process.argv.slice(2)

function wrangler(args) {
	const r = spawnSync("npx", ["--no-install", "wrangler", ...args], {
		stdio: "inherit",
		env: process.env,
		shell: process.platform === "win32",
	})
	process.exit(r.status ?? 1)
}

switch (action) {
	case "create":
		if (!remote) {
			console.error("`db:create` creates a remote Cloudflare D1 database. Use D1_MODE=remote.")
			process.exit(1)
		}
		console.log(
			`Creating D1 database "${db}". Copy the printed database_id into .env (remote) as CLOUDFLARE_D1_REMOTE_DATABASE_ID.`,
		)
		wrangler(["d1", "create", db])
		break
	case "execute": {
		const args = ["d1", "execute", db, remote ? "--remote" : "--local", "--yes"]
		for (let i = 0; i < rest.length; i++) {
			const a = rest[i]
			if (a === "--command")
				(args.push("--command", rest.slice(i + 1).join(" ")), (i = rest.length))
			else args.push(a)
		}
		wrangler(args)
		break
	}
	default:
		console.error("Usage: node scripts/d1.mjs <create|execute> [--file=path | --command SQL]")
		process.exit(1)
}
