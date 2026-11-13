// Unit tests for the Node runtime adapters: SQLite driver (file database, batch = transaction) and the media
// directory storage (round trip, etag, path safety).
// Run: npm run test:runtime   (Node >= 22.16)
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const { SqliteDriver, openSqlite } = await import(`${ROOT}/src/server/sqlite-driver.ts`);
const { FsObjectStorage } = await import(`${ROOT}/src/modules/media/infrastructure/fs-object-storage.ts`);

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }

const dir = mkdtempSync(join(tmpdir(), "nova-runtime-"));

await t("sqlite: file database in WAL mode with foreign keys on", async () => {
  const raw = openSqlite(join(dir, "db", "nova.db"));
  const db = new SqliteDriver(raw);
  assert((await db.prepare("PRAGMA journal_mode").first("journal_mode")) === "wal", "wal");
  assert((await db.prepare("PRAGMA foreign_keys").first("foreign_keys")) === 1, "fk");
  raw.close();
});

await t("sqlite: run / all / first / RETURNING report rows and changes like D1", async () => {
  const db = new SqliteDriver(openSqlite(":memory:"));
  await db.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, flag INTEGER)").run();
  const ins = await db.prepare("INSERT INTO t (name, flag) VALUES (?, ?)").bind("a", true).run();
  assert(ins.meta.changes === 1 && ins.meta.last_row_id === 1 && ins.results.length === 0, JSON.stringify(ins));
  const ret = await db.prepare("UPDATE t SET name = ? RETURNING id, name").bind("b").run();
  assert(ret.meta.changes === 1 && (ret.results[0] as any).name === "b", JSON.stringify(ret));
  const all = await db.prepare("SELECT * FROM t WHERE name = ?").bind(undefined).all();
  assert(all.results.length === 0 && all.meta.changes === 0, "undefined binds as NULL");
  const row = await db.prepare("SELECT * FROM t").first<any>();
  assert(row.flag === 1 && Object.getPrototypeOf(row) === Object.prototype, JSON.stringify(row));
});

await t("sqlite: batch is one transaction — a failing statement rolls back the earlier ones", async () => {
  const db = new SqliteDriver(openSqlite(":memory:"));
  await db.prepare("CREATE TABLE u (id TEXT PRIMARY KEY)").run();
  let threw = false;
  try { await db.batch([db.prepare("INSERT INTO u VALUES ('x')"), db.prepare("INSERT INTO u VALUES ('x')")]); } catch { threw = true; }
  assert(threw && (await db.prepare("SELECT count(*) n FROM u").first("n")) === 0, "rolled back");
  const out = await db.batch([db.prepare("INSERT INTO u VALUES ('y')"), db.prepare("SELECT id FROM u")]);
  assert(out.length === 2 && (out[1]!.results[0] as any).id === "y" && !db.raw.isTransaction, JSON.stringify(out));
});

await t("media: put → get streams the bytes with content type and etag; delete removes both files", async () => {
  const storage = new FsObjectStorage(join(dir, "uploads"));
  await storage.put("products/a1.png", new Uint8Array([1, 2, 3]), "image/png", { mediaId: "a1" });
  const obj = await storage.get("products/a1.png");
  const headers = new Headers();
  obj!.writeHttpMetadata(headers);
  const bytes = new Uint8Array(await new Response(obj!.body).arrayBuffer());
  assert(bytes.join() === "1,2,3" && headers.get("content-type") === "image/png" && /^"[0-9a-f]{32}"$/.test(obj!.httpEtag), obj!.httpEtag);
  await storage.delete("products/a1.png");
  assert((await storage.get("products/a1.png")) === null && !existsSync(join(dir, "uploads/products/a1.png.meta.json")), "deleted");
});

await t("media: keys outside the generated shape are refused (no traversal, no sidecar reads)", async () => {
  const storage = new FsObjectStorage(join(dir, "uploads"));
  for (const bad of ["../etc/passwd", "products/../../x", "/abs/x.png", "noslash.png", "products/.hidden", "products/a1.png.meta.json"]) {
    assert((await storage.get(bad)) === null, `get ${bad}`);
    let threw = false;
    try { await storage.put(bad, new Uint8Array([1]), "image/png", {}); } catch { threw = true; }
    assert(threw, `put ${bad}`);
  }
});

rmSync(dir, { recursive: true, force: true });
console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
