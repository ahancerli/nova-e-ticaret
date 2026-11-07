import { AnalyzeFeedToken, feedAnalyzeSchema } from "@/modules/bulk";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/bulk/feeds/analyze — download a feed URL (https, public hosts, ≤ 15 MB) and map out its structure.
 * Rate limited: every call fetches a third-party site.
 */
export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: feedAnalyzeSchema,
  rateLimit: { name: "feed_fetch", limit: 20, windowSec: 60 },
  handle: ({ body, resolve }) => resolve(AnalyzeFeedToken).execute(body),
});
