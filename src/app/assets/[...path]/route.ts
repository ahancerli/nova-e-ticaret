import { ReadAssetToken, type ByteRange } from "@/modules/media";
import { resolveService } from "@/server/app";

export const dynamic = "force-dynamic";

/**
 * `Range: bytes=a-b | a- | -n` → positions (one range only; `size` resolves the suffix form). `null` = not a range
 * request we serve as a part (absent, malformed, multi-range): the whole object is sent instead.
 */
function parseRange(header: string | null, size: number): ByteRange | "unsatisfiable" | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) {
    const suffix = Number(m[2]);
    return suffix > 0 ? { start: Math.max(0, size - suffix) } : "unsatisfiable";
  }
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : undefined;
  if (start >= size || (end !== undefined && end < start)) return "unsatisfiable";
  return { start, end };
}

/**
 * GET /assets/<folder>/<file> — streams an uploaded image or product video from media storage with long-lived caching.
 * Only keys we generate ("<folder>/<uuid>.<ext>") are served; anything else is a 404 (no traversal, no listing).
 * Byte ranges are answered with 206: Safari / iOS will not play a video from a server that ignores `Range`, and
 * seeking needs it everywhere. Not a JSON route, so it does not use the route() envelope.
 */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const key = (await ctx.params).path.join("/");
  const read = await resolveService(ReadAssetToken);
  const whole = await read.execute(key);
  if (!whole) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  whole.writeHttpMetadata(headers);
  headers.set("ETag", whole.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  if (whole.size !== undefined) headers.set("Accept-Ranges", "bytes");
  if (req.headers.get("if-none-match") === whole.httpEtag) {
    void whole.body.cancel();
    return new Response(null, { status: 304, headers });
  }

  const range = whole.size === undefined ? null : parseRange(req.headers.get("range"), whole.size);
  if (range === null) {
    if (whole.size !== undefined) headers.set("Content-Length", String(whole.size));
    return new Response(whole.body, { headers });
  }
  void whole.body.cancel();
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${whole.size}`);
    return new Response(null, { status: 416, headers });
  }
  const part = await read.execute(key, range);
  if (!part?.range) return new Response("Not found", { status: 404 });
  headers.set("Content-Range", `bytes ${part.range.start}-${part.range.end}/${part.size}`);
  headers.set("Content-Length", String(part.range.end - part.range.start + 1));
  return new Response(part.body, { status: 206, headers });
}
