"use client";

/**
 * Browser side of the API contract (README §4.3):
 *   success → { data, meta, requestId }   ·   failure → { error: { code, message, fieldErrors }, requestId }
 *
 * Every failure becomes a ClientApiError — HTTP errors, network failures, timeouts and non-JSON answers alike —
 * so UI code handles ONE error type. A 401 also emits the `nova:unauthorized` window event; the admin shell
 * listens and sends the user to the login page (session expired), without each screen handling it.
 */
export type FieldErrors = Record<string, string[]>;

export class ClientApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors: FieldErrors = {},
    public requestId: string | null = null,
  ) {
    super(message);
    this.name = "ClientApiError";
  }

  get isNetwork() { return this.status === 0 && this.code !== "aborted"; }
  get isAborted() { return this.code === "aborted"; }
  get isUnauthorized() { return this.status === 401; }
  get isForbidden() { return this.status === 403; }
  get isNotFound() { return this.status === 404; }
  get isConflict() { return this.status === 409; }
  get isValidation() { return this.status === 422 || Object.keys(this.fieldErrors).length > 0; }
  get isRateLimited() { return this.status === 429; }
  get isServer() { return this.status >= 500; }
}

export const UNAUTHORIZED_EVENT = "nova:unauthorized";

export interface Envelope<T> {
  data: T;
  meta: Record<string, unknown>;
  requestId: string;
}

type ErrorPayload = { error?: { code: string; message: string; fieldErrors?: FieldErrors }; requestId?: string };

const DEFAULT_TIMEOUT_MS = 20_000;
const NETWORK_MESSAGE = "Bağlantı hatası. İnternet bağlantınızı kontrol edip tekrar deneyin.";
const TIMEOUT_MESSAGE = "Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.";

function toError(status: number, payload: ErrorPayload | null, fallback: string): ClientApiError {
  const e = payload?.error;
  const err = new ClientApiError(status, e?.code ?? (status ? `http_${status}` : "network_error"), e?.message ?? fallback, e?.fieldErrors ?? {}, payload?.requestId ?? null);
  if (status === 401 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: err }));
  return err;
}

export interface ApiOptions extends Omit<RequestInit, "body"> {
  json?: unknown;
  body?: BodyInit;
  idempotencyKey?: string;
  /** Default 20 s. A caller's `signal` still cancels earlier. */
  timeoutMs?: number;
}

/** AbortSignal.any with a fallback for browsers that lack it (Safari < 17.4). */
function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  const c = new AbortController();
  for (const s of [a, b]) {
    if (s.aborted) c.abort(s.reason);
    else s.addEventListener("abort", () => c.abort(s.reason), { once: true });
  }
  return c.signal;
}

/** Same-origin JSON request that unwraps the envelope and throws ClientApiError for every kind of failure. */
export async function api<T>(path: string, init: ApiOptions = {}): Promise<Envelope<T>> {
  const { json, idempotencyKey, timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Accept", "application/json");
  if (rest.method && rest.method !== "GET") headers.set("Content-Type", "application/json");
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  const timeout = AbortSignal.timeout(timeoutMs);

  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers,
      credentials: "same-origin",
      signal: signal ? anySignal(signal, timeout) : timeout,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (err) {
    if (signal?.aborted) throw new ClientApiError(0, "aborted", "İstek iptal edildi.");
    if (timeout.aborted) throw new ClientApiError(0, "timeout", TIMEOUT_MESSAGE);
    throw Object.assign(new ClientApiError(0, "network_error", NETWORK_MESSAGE), { cause: err });
  }

  const payload = (await res.json().catch(() => null)) as (Envelope<T> & ErrorPayload) | null;
  if (!res.ok || !payload || payload.error) {
    throw toError(res.status, payload, res.ok ? "Sunucudan geçersiz yanıt alındı." : "İşlem tamamlanamadı. Lütfen tekrar deneyin.");
  }
  return payload;
}

/**
 * Multipart upload with progress (fetch cannot report upload progress, so this uses XHR).
 * Same envelope / error contract as `api()`. Abort with `opts.signal`.
 */
export function uploadFile<T>(
  path: string,
  form: FormData,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<Envelope<T>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.withCredentials = true;
    xhr.timeout = 120_000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let payload: (Envelope<T> & ErrorPayload) | null = null;
      try { payload = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status < 200 || xhr.status >= 300 || !payload || payload.error) {
        reject(toError(xhr.status, payload, "Yükleme başarısız. Lütfen tekrar deneyin."));
        return;
      }
      resolve(payload);
    };
    xhr.onerror = () => reject(new ClientApiError(0, "network_error", NETWORK_MESSAGE));
    xhr.ontimeout = () => reject(new ClientApiError(0, "timeout", TIMEOUT_MESSAGE));
    xhr.onabort = () => reject(new ClientApiError(0, "aborted", "Yükleme iptal edildi."));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

export const newIdempotencyKey = () => crypto.randomUUID().replaceAll("-", "");

/**
 * User-facing text for anything thrown. Server errors carry a short reference (start of the request id)
 * so support can find the exact log line.
 */
export function errorMessage(err: unknown, fallback = "İşlem tamamlanamadı. Lütfen tekrar deneyin."): string {
  if (!(err instanceof ClientApiError)) return fallback;
  return err.isServer && err.requestId ? `${err.message} (Ref: ${err.requestId.slice(0, 8)})` : err.message;
}
