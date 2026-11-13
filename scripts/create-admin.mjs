// Creates (or re-roles / resets the password of) an admin user.
//   npm run admin:create -- admin@example.com "Ad Soyad"                                   → DATABASE_PATH (.env.local)
//   docker compose exec app node scripts/create-admin.mjs admin@example.com "Ad Soyad"     → the container's database
// The password is read from the terminal (not from argv, so it never lands in shell history).
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import bcrypt from "bcryptjs";
import { databasePath, loadEnv } from "./env.mjs";
import { hasSchema, openDatabase } from "./sqlite.mjs";

loadEnv();
const path = databasePath();

const [emailArg, nameArg] = process.argv.slice(2);
if (!emailArg) {
  console.error('Usage: npm run admin:create -- <email> "<display name>"');
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
const db = openDatabase(path);
if (!hasSchema(db)) {
  console.error(`✖ ${path} has no schema yet — run: npm run db:setup`);
  process.exit(1);
}

console.log(`→ ${path}: admin ${email}`);
db.exec("BEGIN IMMEDIATE");
try {
  db.prepare("INSERT INTO users (id, email_normalized, display_name) VALUES (?, ?, ?) ON CONFLICT(email_normalized) DO NOTHING").run(randomUUID(), email, nameArg || email);
  const { id } = db.prepare("SELECT id FROM users WHERE email_normalized = ?").get(email);
  db.prepare(
    `INSERT INTO auth_credentials (user_id, password_hash, password_changed_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, password_changed_at = excluded.password_changed_at, failed_attempts = 0, locked_until = NULL`,
  ).run(id, hash);
  db.prepare("INSERT OR IGNORE INTO staff_profiles (user_id) VALUES (?)").run(id);
  db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, 'role_admin')").run(id);
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`✖ ${e.message}`);
  process.exit(1);
}
db.close();
console.log("✓ admin ready");
