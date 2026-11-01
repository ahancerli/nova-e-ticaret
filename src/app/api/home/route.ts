import { handler, ok } from "@/server/http";
import { getHomeData } from "@/server/services/catalog";

export const dynamic = "force-dynamic";

/** Middle area of the home page is fetched client-side (spec R02). */
export const GET = handler(async (req) => ok(req, await getHomeData()));
