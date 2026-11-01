import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
export function makeD1(schemaFiles) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of schemaFiles) db.exec(readFileSync(f, "utf8"));
  const norm = (v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);
  const clean = (r) => (r ? { ...r } : r);
  class Stmt {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...p) { return new Stmt(this.sql, p.map(norm)); }
    _run() { const st = db.prepare(this.sql); if (/^\s*(WITH[\s\S]*?\)\s*)?(SELECT)/i.test(this.sql) && !/^\s*(INSERT|UPDATE|DELETE)/i.test(this.sql)) return { results: st.all(...this.params).map(clean), meta: { changes: 0 }, success: true }; const r = st.run(...this.params); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) }, success: true }; }
    async all() { return this._run(); }
    async first(col) { const r = db.prepare(this.sql).get(...this.params); return r ? (col ? r[col] : clean(r)) : null; }
    async run() { return this._run(); }
  }
  return {
    raw: db,
    prepare: (sql) => new Stmt(sql),
    batch: async (stmts) => { db.exec("BEGIN"); try { const out = stmts.map((s) => s._run()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } },
  };
}
