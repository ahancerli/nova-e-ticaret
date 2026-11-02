import { readAsset } from "@/server/services/media";

export const dynamic = "force-dynamic";

// Only keys we generate: "<folder>/<uuid>.<ext>". Anything else is a 404 (no traversal, no listing).
const KEY = /^(categories|brands|products)\/[0-9a-f-]{36}\.(png|jpg|webp|avif)$/;

/** GET /assets/<folder>/<file> — streams an uploaded image from R2 with long-lived caching. */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const key = (await ctx.params).path.join("/");
  if (!KEY.test(key)) return new Response("Not found", { status: 404 });
  const obj = await readAsset(key);
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
