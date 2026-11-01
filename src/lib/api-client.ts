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

export const newIdempotencyKey = () => crypto.randomUUID().replaceAll("-", "");
