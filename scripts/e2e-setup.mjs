// Prepares an ISOLATED database for the browser tests (npm run test:e2e): data/e2e, never the developer's
// database. Schema + seed, bank transfer switched on, and a known test admin.
import { readFileSync, rmSync } from "node:fs"
import bcrypt from "bcryptjs"
import { openDatabase } from "./sqlite.mjs"

export const E2E_DIR = "data/e2e"
export const E2E_ADMIN = { email: "e2e-admin@nova.test", password: "E2e-browser-tests-2026" }

rmSync(E2E_DIR, { recursive: true, force: true })
const db = openDatabase(`${E2E_DIR}/nova.db`)
db.exec(readFileSync("db/schema.sql", "utf8"))
db.exec(readFileSync("db/seed.sql", "utf8"))

const hash = await bcrypt.hash(E2E_ADMIN.password, 12)
db.exec("UPDATE payment_configs SET is_active = 1 WHERE provider = 'bank_transfer'")
db.prepare("INSERT INTO users (id, email_normalized, display_name) VALUES ('u_e2e_admin', ?, 'E2E Yönetici')").run(E2E_ADMIN.email)
db.prepare("INSERT INTO auth_credentials (user_id, password_hash) VALUES ('u_e2e_admin', ?)").run(hash)
db.exec("INSERT INTO staff_profiles (user_id) VALUES ('u_e2e_admin')")
db.exec("INSERT INTO user_roles (user_id, role_id) VALUES ('u_e2e_admin', 'role_admin')")
db.close()
console.log(`✓ e2e database ready in ${E2E_DIR}`)
