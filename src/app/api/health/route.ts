import { handler, ok } from "@/server/http";
import { queryFirst } from "@/server/db";

export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const row = await queryFirst<{ tables: number }>("SELECT COUNT(*) AS tables FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'");
  return ok(req, { status: "ok", db: "d1", tables: row?.tables ?? 0 });
});
