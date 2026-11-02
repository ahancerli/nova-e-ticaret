// Creates (or re-roles / resets the password of) an admin user in D1.
//   npm run admin:create:local  -- admin@example.com "Ad Soyad"     → local SQLite D1 (.env.local)
//   npm run admin:create        -- admin@example.com "Ad Soyad"     → remote Cloudflare D1 (.env)
// The password is read from the terminal (not from argv, so it never lands in shell history).
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";
import { loadEnv, requireEnv } from "./env.mjs";

loadEnv();
const remote = (process.env.D1_MODE || "remote").toLowerCase() === "remote";
if (remote) requireEnv("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN");
const db = remote
  ? process.env.CLOUDFLARE_D1_REMOTE_DATABASE_NAME || process.env.CLOUDFLARE_D1_DATABASE_NAME
  : process.env.CLOUDFLARE_D1_LOCAL_DATABASE_NAME || process.env.CLOUDFLARE_D1_DATABASE_NAME || "nova-db";
if (!db) {
  console.error("✖ D1 database name is missing (CLOUDFLARE_D1_*_DATABASE_NAME).");
  process.exit(1);
}

const [emailArg, nameArg] = process.argv.slice(2);
if (!emailArg) {
  console.error('Usage: npm run admin:create[:local] -- <email> "<display name>"');
  process.exit(1);
}
const email = emailArg.trim().toLowerCase();
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question("Password (min 12 chars): ");
rl.close();
if (password.length < 12) {
  console.error("Password too short.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
const id = randomUUID();
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;

const sql = `
INSERT INTO users (id, email_normalized, display_name) VALUES (${q(id)}, ${q(email)}, ${q(nameArg || email)})
  ON CONFLICT(email_normalized) DO NOTHING;
INSERT INTO auth_credentials (user_id, password_hash, password_changed_at)
  SELECT id, ${q(hash)}, strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM users WHERE email_normalized = ${q(email)}
  ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, password_changed_at = excluded.password_changed_at, failed_attempts = 0, locked_until = NULL;
INSERT OR IGNORE INTO staff_profiles (user_id) SELECT id FROM users WHERE email_normalized = ${q(email)};
INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT id, 'role_admin' FROM users WHERE email_normalized = ${q(email)};
`;

console.log(`→ ${remote ? "remote" : "local"} D1 "${db}": admin ${email}`);
const r = spawnSync(
  "npx",
  ["--no-install", "wrangler", "d1", "execute", db, remote ? "--remote" : "--local", "--yes", "--command", sql],
  { stdio: "inherit", env: process.env, shell: process.platform === "win32" },
);
process.exit(r.status ?? 1);
