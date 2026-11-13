// In-memory database for the integration tests through the production driver (src/server/sqlite-driver.ts).
// `raw` is the node:sqlite handle for direct setup / assertions.
import { readFileSync } from "node:fs";
import { SqliteDriver, openSqlite } from "../../src/server/sqlite-driver.ts";
export function makeD1(schemaFiles) {
  const db = openSqlite(":memory:");
  for (const f of schemaFiles) db.exec(readFileSync(f, "utf8"));
  return new SqliteDriver(db);
}
