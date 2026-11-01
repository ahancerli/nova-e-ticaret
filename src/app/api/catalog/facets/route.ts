import { handler, ok } from "@/server/http";
import { getFacets } from "@/server/services/catalog";
import { parseListQuery } from "@/server/validation";

export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const p = parseListQuery(new URL(req.url).searchParams);
  return ok(req, await getFacets(p));
});
