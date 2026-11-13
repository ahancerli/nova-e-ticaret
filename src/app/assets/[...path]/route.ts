import { ReadAssetToken } from "@/modules/media";
import { resolveService } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * GET /assets/<folder>/<file> — streams an uploaded image from media storage with long-lived caching.
 * Only keys we generate ("<folder>/<uuid>.<ext>") are served; anything else is a 404 (no traversal, no listing).
 * Not a JSON route, so it does not use the route() envelope.
 */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const key = (await ctx.params).path.join("/");
  const obj = await (await resolveService(ReadAssetToken)).execute(key);
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  if (req.headers.get("if-none-match") === obj.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
}
