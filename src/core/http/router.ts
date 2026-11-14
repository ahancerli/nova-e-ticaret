import type { ZodType } from "zod";
import type { Container, Resolver, Token } from "../di/container";
import { BadRequestError, ForbiddenError, PayloadTooLargeError, UnauthorizedError } from "../errors";
import type { Logger } from "../logging/logger";
import { errorResponse } from "./error-response";
import {
  AuthenticatorToken,
  CaptchaGuardToken,
  IdempotencyStoreToken,
  LoggerToken,
  OriginGuardToken,
  PrincipalToken,
  RateLimiterToken,
  RequestContextToken,
  type Audience,
  type Principal,
  type RequestContext,
} from "./ports";
import { Reply, jsonResponse, type SuccessBody } from "./reply";

/**
 * Declarative route definitions.
 *
 *   export const PUT = route({
 *     auth: { audience: "admin", permission: "catalog.write" },
 *     params: z.object({ id: z.string() }),
 *     body: categoryUpdateSchema,
 *     handle: ({ params, body, resolve }) => resolve(UpdateCategory).execute(params.id, body),
 *   });
 *
 * Every request passes the same pipeline (Chain of Responsibility), in this order:
 *   error boundary → request scope → rate limit → origin/CSRF → authentication/authorization
 *   → params/query/body validation → CAPTCHA → idempotency → handler → envelope.
 * Handlers contain no cross-cutting code; they receive validated input and resolve their use case from DI.
 */

type Unsafe = "POST" | "PUT" | "PATCH" | "DELETE";
const UNSAFE = new Set<string>(["POST", "PUT", "PATCH", "DELETE"] satisfies Unsafe[]);
const DEFAULT_BODY_LIMIT = 64 * 1024;

export type AuthRule =
  | { audience: "public" }
  | { audience: "storefront"; required?: boolean }
  | { audience: "admin"; permission?: string | string[] };

export interface HandlerContext<P, Q, B> {
  req: Request;
  params: P;
  query: Q;
  body: B;
  /** The caller; non-null for admin routes and storefront routes with `required: true`. */
  user: Principal | null;
  requestId: string;
  logger: Logger;
  resolve<T>(t: Token<T>): T;
}

export interface RouteDefinition<P, Q, B, R> {
  /** Default: public. */
  auth?: AuthRule;
  /** Same-origin check for cookie-authenticated writes. Default: "json" on POST/PUT/PATCH/DELETE. */
  csrf?: "json" | "multipart" | "none";
  params?: ZodType<P>;
  query?: ZodType<Q>;
  /** JSON body schema. Leave out for multipart routes and read `req.formData()` in the handler. */
  body?: ZodType<B>;
  bodyLimit?: number;
  /** Counts every request: `limit` per `windowSec` per caller IP. */
  rateLimit?: { name: string; limit: number; windowSec: number };
  /**
   * Bot protection: the form key ("signup", "login", …) checked by the CaptchaGuard after validation, so an invalid
   * form never spends the provider call. The guard decides from the panel settings whether the form is protected.
   */
  captcha?: string;
  /** Requires an Idempotency-Key header; the scope may include path params (e.g. `order.action:<id>`). */
  idempotency?: { scope: (input: { params: P; user: Principal | null }) => string };
  /** Default "no-store" for anything that is not public. */
  cacheControl?: string;
  /** A returned `Response` (e.g. an event stream) is sent as is; not combinable with `idempotency`. */
  handle(ctx: HandlerContext<P, Q, B>): Promise<R | Reply<R> | Response>;
}

type NextContext = { params: Promise<Record<string, string | string[] | undefined>> };
export type RouteHandler = (req: Request, ctx: NextContext) => Promise<Response>;

export interface RouterOptions {
  root: Container;
  /** Fills a fresh request scope with per-request values (env bindings, database, …). */
  prepareScope?: (scope: Container, req: Request) => Promise<void>;
  requestId?: (req: Request) => string;
  exposeStack?: () => boolean;
}

export function createRouter(options: RouterOptions) {
  const requestIdOf = options.requestId ?? ((req: Request) => req.headers.get("cf-ray") ?? crypto.randomUUID());

  return function route<P = Record<string, never>, Q = Record<string, never>, B = undefined, R = unknown>(def: RouteDefinition<P, Q, B, R>): RouteHandler {
    const auth: AuthRule = def.auth ?? { audience: "public" };

    return async (req, nextCtx) => {
      const requestId = requestIdOf(req);
      const url = new URL(req.url);
      const baseLogger = options.root.has(LoggerToken) ? options.root.resolve(LoggerToken) : null;
      const logger = (baseLogger ?? silentLogger).child({ requestId, route: `${req.method} ${url.pathname}` });
      const exposeStack = options.exposeStack?.() ?? false;

      try {
        const scope = options.root.createScope();
        const context: RequestContext = { requestId, method: req.method, path: url.pathname, logger, startedAt: Date.now() };
        scope.provide(RequestContextToken, context).provide(LoggerToken, logger);
        await options.prepareScope?.(scope, req);

        if (def.rateLimit) {
          const limiter = scope.resolve(RateLimiterToken);
          await limiter.hit(`${def.rateLimit.name}:${await limiter.clientKey(req)}`, def.rateLimit.limit, def.rateLimit.windowSec);
        }

        const csrf = def.csrf ?? "json";
        if (UNSAFE.has(req.method) && csrf !== "none") await scope.resolve(OriginGuardToken).assert(req, csrf);

        const user = await authorize(scope, auth);
        scope.provide(PrincipalToken, user);

        const params = def.params ? def.params.parse(await nextCtx.params) : ({} as P);
        const query = def.query ? def.query.parse(Object.fromEntries(url.searchParams)) : ({} as Q);
        const body = def.body ? def.body.parse(await readJsonBody(req, def.bodyLimit ?? DEFAULT_BODY_LIMIT)) : (undefined as B);
        if (def.captcha) await scope.resolve(CaptchaGuardToken).assert(req, def.captcha);

        const ctx: HandlerContext<P, Q, B> = { req, params, query, body, user, requestId, logger, resolve: (t) => scope.resolve(t) };
        const run = async () => {
          const out = await def.handle(ctx);
          if (out instanceof Response) throw new Error("idempotent routes cannot return a raw Response");
          return out instanceof Reply ? out : new Reply(out);
        };

        let result: Reply<R>;
        let replayed = false;
        if (def.idempotency) {
          const stored = await scope.resolve(IdempotencyStoreToken).run(req, def.idempotency.scope({ params, user }), body ?? {}, async () => {
            const r = await run();
            return { status: r.status, data: { data: r.data, meta: r.meta } };
          });
          result = new Reply(stored.data.data, stored.status, stored.data.meta);
          replayed = stored.replayed;
        } else {
          const out = await def.handle(ctx);
          if (out instanceof Response) return out; // streams (SSE) bypass the JSON envelope
          result = out instanceof Reply ? out : new Reply(out);
        }

        const payload: SuccessBody<R> = { data: result.data, meta: result.meta, requestId };
        const headers: Record<string, string> = {
          "cache-control": def.cacheControl ?? (auth.audience === "public" ? "no-cache" : "no-store"),
          ...result.headers,
        };
        if (replayed) headers["idempotent-replayed"] = "true";
        return jsonResponse(payload, result.status, headers);
      } catch (err) {
        return errorResponse(err, { requestId, logger, exposeStack });
      }
    };
  };
}

async function authorize(scope: Resolver, rule: AuthRule): Promise<Principal | null> {
  if (rule.audience === "public") return null;
  const audience: Audience = rule.audience;
  const user = await scope.resolve(AuthenticatorToken).current(audience);
  if (rule.audience === "storefront") {
    if (rule.required && !user) throw new UnauthorizedError();
    return user;
  }
  if (!user) throw new UnauthorizedError();
  const needed = rule.permission === undefined ? [] : Array.isArray(rule.permission) ? rule.permission : [rule.permission];
  if (!user.isStaff || !needed.every((p) => user.permissions.has(p))) throw new ForbiddenError();
  return user;
}

/** Reads a JSON body with a hard size limit (header and actual length). Empty body → `{}`. */
export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new PayloadTooLargeError();
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new PayloadTooLargeError();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequestError("invalid_json", "Geçersiz JSON.");
  }
}

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
};
