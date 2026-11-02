// Creates the remote R2 bucket used for uploaded media (wrangler.jsonc → r2_buckets.ASSETS_BUCKET).
//   npm run r2:create
// Local dev needs nothing: wrangler keeps a local R2 copy under .wrangler/.
import { spawnSync } from "node:child_process"
import { loadEnv, requireEnv } from "./env.mjs"

loadEnv(".env")
requireEnv("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN")

const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME || "nova-assets"
const r = spawnSync("npx", ["--no-install", "wrangler", "r2", "bucket", "create", bucket], {
	stdio: "inherit",
	env: process.env,
	shell: process.platform === "win32",
})
process.exit(r.status ?? 1)
