import { DatabaseToken } from "@/core";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

// Public endpoint: proves the DB answers without revealing anything about the schema.
export const GET = route({
  cacheControl: "no-store",
  handle: async ({ resolve }) => {
    await resolve(DatabaseToken).first<{ ok: number }>("SELECT 1 AS ok");
    return { status: "ok" };
  },
});
