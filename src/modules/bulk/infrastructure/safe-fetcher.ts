import { BulkErrors } from "../domain/errors";
import { assertPublicUrl } from "../domain/url";
import type { RemoteFetcher } from "../application/ports";

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw BulkErrors.tooLarge(Math.round(maxBytes / 1024 / 1024));
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw BulkErrors.tooLarge(Math.round(maxBytes / 1024 / 1024)); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

/** Charset from the header or the XML declaration (Turkish feeds are often windows-1254 / ISO-8859-9). */
function decode(bytes: Uint8Array, contentType: string): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const label = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<\?xml[^>]*encoding=["']([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
  try { return new TextDecoder(label.toLowerCase()).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

/**
 * Outgoing HTTP for feeds and images with SSRF guards. On Workers `global_fetch_strictly_public` (wrangler.jsonc)
 * already refuses private addresses after DNS; every URL — and every redirect hop (≤ 3, followed by hand) — is also
 * checked by `assertPublicUrl` (covers local dev on Node). Bodies are read as a stream and cut at `maxBytes`; every
 * request has a timeout; an API key header is not carried to another host on redirect.
 */
export class SafeFetcher implements RemoteFetcher {
  constructor(private readonly doFetch: typeof fetch = (...a) => fetch(...a)) {}

  private async request(url: string, headers: Record<string, string>, timeoutMs: number): Promise<Response> {
    let current = assertPublicUrl(url);
    for (let hop = 0; hop <= 3; hop++) {
      let res: Response;
      try {
        res = await this.doFetch(current.href, { headers: { "user-agent": "nova-commerce-feed/1.0", ...headers }, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        throw BulkErrors.fetchFailed(e instanceof Error && e.name === "TimeoutError" ? "zaman aşımı." : "bağlantı kurulamadı.");
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location")!, current);
        // credentials / API keys are not carried to another host
        if (next.host !== current.host) headers = {};
        current = assertPublicUrl(next.href);
        continue;
      }
      if (!res.ok) throw BulkErrors.fetchFailed(`sunucu ${res.status} döndü.`);
      return res;
    }
    throw BulkErrors.fetchFailed("çok fazla yönlendirme.");
  }

  async text(url: string, opts: { headers?: Record<string, string>; maxBytes: number; timeoutMs: number }) {
    const res = await this.request(url, opts.headers ?? {}, opts.timeoutMs);
    const contentType = res.headers.get("content-type") ?? "";
    return { text: decode(await readCapped(res, opts.maxBytes), contentType), contentType };
  }

  async bytes(url: string, opts: { maxBytes: number; timeoutMs: number }) {
    return readCapped(await this.request(url, {}, opts.timeoutMs), opts.maxBytes);
  }
}
