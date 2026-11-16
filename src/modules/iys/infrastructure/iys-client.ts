import { IYS_BASE_URL, type IysChange, type IysChannel, type IysEnvironment, type IysStatus } from "../domain/iys";

const TIMEOUT_MS = 15_000;

export interface IysCredentials {
  environment: IysEnvironment;
  iysCode: string;
  brandCode: string;
  username: string;
  password: string;
}

/** İYS answered with an error. `final` = 4xx (except 401 / 429): the record is refused, retrying will not help. */
export class IysHttpError extends Error {
  constructor(readonly status: number, message: string, readonly code: string | null = null) { super(message); }
  get final() { return this.status >= 400 && this.status < 500 && this.status !== 401 && this.status !== 429; }
}

/** Port: the İYS HTTP API (tests swap it). */
export interface IysApi {
  addConsent(c: IysCredentials, consent: { consentDate: string; source: string; recipient: string; status: IysStatus; type: IysChannel }): Promise<{ transactionId: string | null }>;
  changes(c: IysCredentials, after: string | null, limit: number): Promise<{ after: string | null; list: IysChange[] }>;
  /** Signs in (proves the credentials). */
  test(c: IysCredentials): Promise<void>;
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

export class HttpIysApi implements IysApi {
  async test(c: IysCredentials): Promise<void> {
    await this.token(c, true);
  }

  async addConsent(c: IysCredentials, consent: { consentDate: string; source: string; recipient: string; status: IysStatus; type: IysChannel }) {
    const r = await this.call<{ transactionId?: string }>(c, "POST", `/sps/${c.iysCode}/brands/${c.brandCode}/consents`, { ...consent, recipientType: "BIREYSEL" });
    return { transactionId: r?.transactionId ?? null };
  }

  async changes(c: IysCredentials, after: string | null, limit: number) {
    const q = new URLSearchParams({ limit: String(limit), ...(after ? { after } : {}) });
    const r = await this.call<{ after?: string | null; list?: { recipient: string; type: string; status: IysStatus; consentDate?: string; transactionId?: string }[] }>(
      c, "GET", `/sps/${c.iysCode}/brands/${c.brandCode}/consents/changes?${q}`,
    );
    return {
      after: r?.after ?? after,
      list: (r?.list ?? []).map((x) => ({ recipient: x.recipient, type: x.type, status: x.status, consentDate: x.consentDate ?? null, transactionId: x.transactionId ?? null })),
    };
  }

  private async token(c: IysCredentials, fresh = false): Promise<string> {
    const key = `${c.environment}|${c.username}`;
    const hit = tokens.get(key);
    if (!fresh && hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
    const res = await fetch(`${IYS_BASE_URL[c.environment]}/oauth2/token`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ username: c.username, password: c.password, grant_type: "password" }), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; message?: string };
    if (!res.ok || !json.access_token) throw new IysHttpError(res.status === 401 ? 400 : res.status, `İYS oturumu açılamadı: ${json.error_description ?? json.message ?? res.status}`);
    tokens.set(key, { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 });
    return json.access_token;
  }

  private async call<T>(c: IysCredentials, method: "GET" | "POST", path: string, body?: unknown, retried = false): Promise<T> {
    const res = await fetch(`${IYS_BASE_URL[c.environment]}${path}`, {
      method, headers: { authorization: `Bearer ${await this.token(c, retried)}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 && !retried) return this.call<T>(c, method, path, body, true);
    const json = (await res.json().catch(() => null)) as (T & { errors?: { code?: string; message?: string }[]; message?: string }) | null;
    if (!res.ok) {
      const err = json?.errors?.[0];
      throw new IysHttpError(res.status, err?.message ?? json?.message ?? `HTTP ${res.status}`, err?.code ?? null);
    }
    return json as T;
  }
}

/** Tests: forget cached tokens. */
export const clearIysTokens = () => tokens.clear();
