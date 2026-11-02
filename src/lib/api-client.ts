"use client";

export class ClientApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors: Record<string, string[]> = {}) {
    super(message);
  }
}

type Envelope<T> = { data: T; meta: Record<string, unknown>; requestId: string };

/** Same-origin JSON fetch that unwraps the {data, meta} envelope and throws ClientApiError. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown; idempotencyKey?: string } = {}): Promise<Envelope<T>> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.method && init.method !== "GET") headers.set("Content-Type", "application/json");
  if (init.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const payload = (await res.json().catch(() => null)) as (Envelope<T> & { error?: { code: string; message: string; fieldErrors?: Record<string, string[]> } }) | null;
  if (!res.ok || !payload || payload.error) {
    const e = payload?.error;
    throw new ClientApiError(res.status, e?.code ?? "network_error", e?.message ?? "Bağlantı hatası. Lütfen tekrar deneyin.", e?.fieldErrors);
  }
  return payload;
}

/**
 * Multipart upload with progress (fetch cannot report upload progress, so this uses XHR).
 * Same envelope/error contract as `api()`. Abort with the returned controller's signal.
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
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let payload: (Envelope<T> & { error?: { code: string; message: string; fieldErrors?: Record<string, string[]> } }) | null = null;
      try { payload = JSON.parse(xhr.responseText); } catch { /* non-JSON error page */ }
      if (xhr.status < 200 || xhr.status >= 300 || !payload || payload.error) {
        const e = payload?.error;
        reject(new ClientApiError(xhr.status, e?.code ?? "upload_failed", e?.message ?? "Yükleme başarısız. Lütfen tekrar deneyin.", e?.fieldErrors));
        return;
      }
      resolve(payload);
    };
    xhr.onerror = () => reject(new ClientApiError(0, "network_error", "Bağlantı hatası. Lütfen tekrar deneyin."));
    xhr.onabort = () => reject(new ClientApiError(0, "aborted", "Yükleme iptal edildi."));
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

export const newIdempotencyKey =() => crypto.randomUUID().replaceAll("-", "");
