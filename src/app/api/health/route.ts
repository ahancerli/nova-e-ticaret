import { handler, ok } from "@/server/http";
import { queryFirst } from "@/server/db";

export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  // Public endpoint: proves the DB answers without revealing anything about the schema.
  await queryFirst<{ ok: number }>("SELECT 1 AS ok");
  return ok(req, { status: "ok" });
});
