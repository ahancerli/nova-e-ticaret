// Prepares an ISOLATED local D1 for the browser tests (npm run test:e2e): .wrangler/e2e, never the
// developer's database. Schema + seed, bank transfer switched on, and a known test admin.
import { rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import bcrypt from "bcryptjs"
import { loadEnv } from "./env.mjs"

loadEnv()
export const E2E_DIR = ".wrangler/e2e"
export const E2E_ADMIN = { email: "e2e-admin@nova.test", password: "E2e-browser-tests-2026" }
const db = process.env.CLOUDFLARE_D1_LOCAL_DATABASE_NAME || process.env.CLOUDFLARE_D1_DATABASE_NAME || "nova-local"

function d1(args) {
	const r = spawnSync("npx", ["--no-install", "wrangler", "d1", "execute", db, "--local", "--persist-to", E2E_DIR, "--yes", ...args], { stdio: "pipe", encoding: "utf8" })
	if (r.status !== 0) {
		process.stderr.write(r.stdout + r.stderr)
		process.exit(r.status ?? 1)
	}
}

rmSync(E2E_DIR, { recursive: true, force: true })
d1(["--file=db/schema.sql"])
d1(["--file=db/seed.sql"])

const hash = await bcrypt.hash(E2E_ADMIN.password, 12)
d1(["--command", `
UPDATE payment_configs SET is_active = 1 WHERE provider = 'bank_transfer';
INSERT INTO users (id, email_normalized, display_name) VALUES ('u_e2e_admin', '${E2E_ADMIN.email}', 'E2E Yönetici');
INSERT INTO auth_credentials (user_id, password_hash) VALUES ('u_e2e_admin', '${hash}');
INSERT INTO staff_profiles (user_id) VALUES ('u_e2e_admin');
INSERT INTO user_roles (user_id, role_id) VALUES ('u_e2e_admin', 'role_admin');
`])
console.log(`✓ e2e database ready in ${E2E_DIR}`)
