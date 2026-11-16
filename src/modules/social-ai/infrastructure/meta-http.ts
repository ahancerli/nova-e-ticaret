import { META_GRAPH_VERSION } from "../domain/social-ai";

/**
 * Shared HTTP plumbing for Meta's Graph APIs (WhatsApp Cloud API on graph.facebook.com, Instagram API with Instagram
 * Login on graph.instagram.com). Endpoints, scopes and payloads were checked against developers.facebook.com on
 * 2026-11-16; the version below is the one those pages show.
 */
export const GRAPH_VERSION = META_GRAPH_VERSION;
export const FB_GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const IG_GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const TIMEOUT_MS = 20_000;

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;
type Obj = Record<string, unknown>;

export const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
export const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
export const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

/** Meta answered with an error object, or did not answer (`status` 0). The raw message stays in logs. */
export class MetaApiError extends Error {
  constructor(readonly status: number, readonly code: number | null, readonly subcode: number | null, message: string) {
    super(message);
    this.name = "MetaApiError";
  }

  /** The token is invalid / expired / lacks a permission (OAuthException 190, permission errors 10 and 200–299). */
  get auth(): boolean {
    return this.status === 401 || this.code === 190 || this.code === 10 || (this.code != null && this.code >= 200 && this.code < 300);
  }

  /** Worth retrying: network, 5xx, throttling (4, 17, 32, 613, 80007 and WhatsApp 130429 / 131016 / 131056). */
  get transient(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429 || [4, 17, 32, 613, 80007, 130429, 131016, 131056].includes(this.code ?? -1);
  }
}

export async function metaCall(
  fetchFn: FetchFn, method: "GET" | "POST" | "DELETE", url: string,
  opts: { token?: string; json?: unknown; form?: Record<string, string>; query?: Record<string, string> } = {},
): Promise<Obj> {
  const target = opts.query ? `${url}${url.includes("?") ? "&" : "?"}${new URLSearchParams(opts.query)}` : url;
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(opts.json); }
  else if (opts.form) { headers["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(opts.form).toString(); }

  let res: Response;
  try {
    res = await fetchFn(target, { method, headers, ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new MetaApiError(0, null, null, err instanceof Error ? err.name : "network");
  }
  const text = await res.text();
  let out: Obj = {};
  try { out = obj(JSON.parse(text)); } catch { /* not JSON */ }
  if (res.ok && !out.error) return out;
  const e = obj(out.error);
  const code = typeof e.code === "number" ? e.code : null;
  const subcode = typeof e.error_subcode === "number" ? e.error_subcode : null;
  // Instagram's OAuth endpoint answers { error_type, code, error_message }.
  throw new MetaApiError(res.status, code ?? (typeof out.code === "number" ? out.code : null), subcode, (str(e.message) ?? str(out.error_message) ?? `HTTP ${res.status}`).slice(0, 300));
}
