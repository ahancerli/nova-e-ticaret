/**
 * Response contract (README §4.3):
 *   success → { data, meta, requestId }
 *   failure → { error: { code, message, fieldErrors }, requestId }
 */
export type Meta = Record<string, unknown>;

export interface SuccessBody<T> {
  data: T;
  meta: Meta;
  requestId: string;
}

export interface ErrorBody {
  error: { code: string; message: string; fieldErrors: Record<string, string[]> };
  requestId: string;
}

/** What a handler returns when it needs more than plain data: a status, meta or extra headers. */
export class Reply<T> {
  constructor(
    readonly data: T,
    readonly status = 200,
    readonly meta: Meta = {},
    readonly headers: Record<string, string> = {},
  ) {}
}

export const reply = {
  ok: <T>(data: T, meta: Meta = {}) => new Reply(data, 200, meta),
  created: <T>(data: T, meta: Meta = {}) => new Reply(data, 201, meta),
  accepted: <T>(data: T, meta: Meta = {}) => new Reply(data, 202, meta),
};

export function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
