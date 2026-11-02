// Unit tests for src/core: DI container, error translation, UnitOfWork (against the real schema + triggers),
// HTTP route pipeline (with fake ports) and logger redaction.
// Run: npm run test:core   (Node >= 22.13)
import { z } from "zod";
import { makeD1 } from "../integration/d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const {
  Container, ContainerError, token, toAppError, AppError, ConflictError, NotFoundError, ValidationError, InternalError,
  D1DatabaseAdapter, UnitOfWork, JsonLogger, redact, createRouter, reply,
  AuthenticatorToken, OriginGuardToken, RateLimiterToken, IdempotencyStoreToken, LoggerToken, ForbiddenError, RateLimitError,
} = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
async function rejects(fn: () => Promise<unknown> | unknown, check: (e: any) => boolean, m: string) {
  try { await fn(); } catch (e) { assert(check(e), `${m}: wrong error ${(e as Error)?.message}`); return; }
  throw new Error(`${m}: did not throw`);
}

// --- DI container --------------------------------------------------------------------------------
await t("container: singleton shared, scoped per scope, transient always new", () => {
  const S = token<{ n: number }>("S"), Sc = token<{ n: number }>("Sc"), Tr = token<{ n: number }>("Tr");
  let i = 0;
  const root = new Container().singleton(S, () => ({ n: i++ })).scoped(Sc, () => ({ n: i++ })).transient(Tr, () => ({ n: i++ }));
  const a = root.createScope(), b = root.createScope();
  assert(a.resolve(S) === b.resolve(S), "singleton shared across scopes");
  assert(a.resolve(Sc) === a.resolve(Sc) && a.resolve(Sc) !== b.resolve(Sc), "scoped per scope");
  assert(a.resolve(Tr) !== a.resolve(Tr), "transient new each time");
});
await t("container: scoped from root, captive dependency and cycles are rejected", async () => {
  const Sc = token<object>("Scoped"), Si = token<object>("Single"), A = token<object>("A"), B = token<object>("B");
  const root = new Container().scoped(Sc, () => ({})).singleton(Si, (c) => ({ dep: c.resolve(Sc) }))
    .scoped(A, (c) => ({ b: c.resolve(B) })).scoped(B, (c) => ({ a: c.resolve(A) }));
  await rejects(() => root.resolve(Sc), (e) => e instanceof ContainerError, "scoped on root");
  await rejects(() => root.createScope().resolve(Si), (e) => e instanceof ContainerError && /scoped/.test(e.message), "captive");
  await rejects(() => root.createScope().resolve(A), (e) => /Circular dependency: A → B → A/.test(e.message), "cycle");
  await rejects(() => root.createScope().resolve(token("Missing")), (e) => /No registration for "Missing"/.test(e.message), "missing");
});
await t("container: provide() overrides per scope only", () => {
  const V = token<string>("V");
  const root = new Container().scoped(V, () => "default");
  const a = root.createScope().provide(V, "request-a");
  assert(a.resolve(V) === "request-a" && root.createScope().resolve(V) === "default", "provide is scope-local");
});

// --- errors --------------------------------------------------------------------------------------
await t("errors: zod, trigger, constraint and unknown errors are normalized", () => {
  const zodErr = (() => { try { z.object({ email: z.string().email() }).parse({ email: "x" }); } catch (e) { return e; } })();
  const v = toAppError(zodErr);
  assert(v instanceof ValidationError && v.status === 422 && v.fieldErrors.email?.length === 1, JSON.stringify(v));
  const stock = toAppError(new Error("D1_ERROR: insufficient_stock: SQLITE_CONSTRAINT"));
  assert(stock instanceof ConflictError && stock.code === "insufficient_stock" && stock.details.dbMessage, "trigger");
  const uniq = toAppError(new Error("UNIQUE constraint failed: brands.slug"));
  assert(uniq.status === 409 && uniq.code === "conflict", "unique");
  const boom = toAppError(new TypeError("x is undefined"));
  assert(boom instanceof InternalError && !boom.expose && boom.cause instanceof TypeError, "unknown → internal, not exposed");
  const nf = new NotFoundError("category_not_found", "Kategori bulunamadı.");
  assert(toAppError(nf) === nf && nf instanceof AppError && nf.name === "NotFoundError", "AppError passes through");
});

// --- UnitOfWork ----------------------------------------------------------------------------------
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
const db = new D1DatabaseAdapter(d1 as any);

await t("unit of work: guard passes → everything commits, guard rows are invisible", async () => {
  const uow = new UnitOfWork(db);
  uow.add(db.statement("UPDATE brands SET name = name WHERE id = ?", "b_atelier")).expectChanges(1);
  uow.add(db.statement("INSERT INTO audit_logs (id, action, entity_type) VALUES (?, 'uow.test', 'x')", "uow1"));
  const results = await uow.commit();
  assert(results.length === 2, `results without guard rows: ${results.length}`);
  assert((await db.first<{ n: number }>("SELECT count(*) AS n FROM audit_logs WHERE id = 'uow1'"))!.n === 1, "committed");
  assert((await db.first<{ n: number }>("SELECT count(*) AS n FROM batch_guards"))!.n === 0, "guard table empty");
});
await t("unit of work: lost race → whole batch rolled back with the guard's error", async () => {
  const uow = new UnitOfWork(db);
  uow.add(db.statement("INSERT INTO audit_logs (id, action, entity_type) VALUES (?, 'uow.test', 'x')", "uow2"));
  uow.add(db.statement("UPDATE brands SET name = 'X' WHERE id = ? AND name = 'not-current'", "b_atelier"))
    .expectChanges(1, () => new ConflictError("brand_changed", "Marka bu sırada değişti."));
  uow.add(db.statement("INSERT INTO audit_logs (id, action, entity_type) VALUES (?, 'uow.test', 'x')", "uow3"));
  await rejects(() => uow.commit(), (e) => e instanceof ConflictError && e.code === "brand_changed", "guard error");
  assert((await db.first<{ n: number }>("SELECT count(*) AS n FROM audit_logs WHERE id IN ('uow2','uow3')"))!.n === 0, "nothing written");
  await rejects(() => uow.commit(), (e) => /already committed/.test(e.message), "single use");
});
await t("unit of work: with several guards, the error of the guard that fired is thrown", async () => {
  const uow = new UnitOfWork(db);
  uow.add(db.statement("UPDATE brands SET name = name WHERE id = ?", "b_atelier")).expectChanges(1, () => new ConflictError("first", "1"));
  uow.add(db.statement("UPDATE brands SET name = name WHERE id = ?", "missing")).expectChanges(1, () => new ConflictError("second", "2"));
  uow.add(db.statement("UPDATE brands SET name = name WHERE id = ?", "b_linen")).expectChanges(1, () => new ConflictError("third", "3"));
  await rejects(() => uow.commit(), (e) => e.code === "second", "second guard");
});

// --- logger --------------------------------------------------------------------------------------
await t("logger: sensitive keys are redacted, child bindings are kept", () => {
  const lines: string[] = [];
  const log = new JsonLogger({ level: "info", sink: (_l: string, line: string) => lines.push(line) }).child({ requestId: "r1" });
  log.debug("hidden");
  log.info("login", { email: "a@b.c", password: "hunter2", nested: { apiKey: "k", ok: 1 }, headers: { Authorization: "Bearer x" } });
  assert(lines.length === 1, "debug filtered");
  const e = JSON.parse(lines[0]!);
  assert(e.requestId === "r1" && e.password === "[redacted]" && e.nested.apiKey === "[redacted]" && e.nested.ok === 1 && e.headers.Authorization === "[redacted]" && e.email === "a@b.c", lines[0]!);
  assert((redact({ a: { b: { c: { d: { e: 1 } } } } }) as any).a.b.c.d === "[depth]", "depth bound");
});

// --- HTTP route pipeline -------------------------------------------------------------------------
function makeRouter(opts: { user?: any; originOk?: boolean; limited?: boolean } = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const root = new Container()
    .singleton(LoggerToken, () => new JsonLogger({ level: "debug", sink: (_l: string, line: string) => logs.push(line) }))
    .singleton(AuthenticatorToken, () => ({ current: async (aud: string) => { calls.push(`auth:${aud}`); return opts.user ?? null; } }))
    .singleton(OriginGuardToken, () => ({ assert: async (_r: Request, mode: string) => { calls.push(`origin:${mode}`); if (opts.originOk === false) throw new ForbiddenError("bad_origin", "İstek kaynağı doğrulanamadı."); } }))
    .singleton(RateLimiterToken, () => ({ clientKey: async () => "ip1", check: async () => {}, hit: async (k: string) => { calls.push(`rate:${k}`); if (opts.limited) throw new RateLimitError(); } }))
    .singleton(IdempotencyStoreToken, () => {
      const store = new Map<string, any>();
      return { run: async (req: Request, scope: string, _b: unknown, fn: () => Promise<any>) => {
        const k = `${scope}:${req.headers.get("idempotency-key")}`;
        if (store.has(k)) return { ...store.get(k), replayed: true };
        const r = await fn(); store.set(k, r); return { ...r, replayed: false };
      } };
    });
  return { route: createRouter({ root, requestId: () => "req-1" }), calls, logs };
}
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://nova.test/api/x", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const admin = { id: "u1", email: "a@x", displayName: "A", sessionId: "s", isStaff: true, permissions: new Set(["catalog.write"]) };

await t("route: success envelope, validated params/query/body, created status", async () => {
  const { route } = makeRouter({ user: admin });
  const h = route({
    auth: { audience: "admin", permission: "catalog.write" },
    params: z.object({ id: z.string().min(1) }),
    query: z.object({ q: z.string().optional() }),
    body: z.object({ name: z.string().trim().min(2) }),
    handle: async ({ params, body, user }: any) => reply.created({ id: params.id, name: body.name, by: user.id }, { note: 1 }),
  });
  const res = await h(new Request("https://nova.test/api/x?q=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "  Kazak " }) }), ctx({ id: "c1" }));
  const json = await res.json();
  assert(res.status === 201 && json.data.name === "Kazak" && json.data.by === "u1" && json.meta.note === 1 && json.requestId === "req-1", JSON.stringify(json));
  assert(res.headers.get("cache-control") === "no-store", "admin responses are no-store");
});
await t("route: validation error → 422 with fieldErrors; handler not called", async () => {
  const { route } = makeRouter();
  let called = false;
  const h = route({ body: z.object({ email: z.string().email() }), handle: async () => { called = true; return {}; } });
  const res = await h(post({ email: "nope" }), ctx());
  const json = await res.json();
  assert(res.status === 422 && json.error.code === "validation_error" && json.error.fieldErrors.email && !called, JSON.stringify(json));
});
await t("route: pipeline order and guards (rate → origin → auth → permission)", async () => {
  const anon = makeRouter();
  const r1 = await anon.route({ auth: { audience: "admin" }, rateLimit: { name: "t", limit: 5, windowSec: 60 }, handle: async () => ({}) })(post({}), ctx());
  assert(r1.status === 401 && anon.calls.join() === "rate:t:ip1,origin:json,auth:admin", anon.calls.join());
  const noPerm = makeRouter({ user: { ...admin, permissions: new Set() } });
  assert((await noPerm.route({ auth: { audience: "admin", permission: "catalog.write" }, handle: async () => ({}) })(post({}), ctx())).status === 403, "permission");
  const badOrigin = makeRouter({ user: admin, originOk: false });
  const r3 = await badOrigin.route({ auth: { audience: "admin" }, handle: async () => ({}) })(post({}), ctx());
  assert(r3.status === 403 && !badOrigin.calls.includes("auth:admin"), "origin checked before auth");
  const limited = makeRouter({ limited: true });
  const r4 = await limited.route({ rateLimit: { name: "t", limit: 1, windowSec: 60 }, handle: async () => ({}) })(post({}), ctx());
  assert(r4.status === 429 && r4.headers.get("retry-after") === "60", "rate limited");
  const get = makeRouter();
  await get.route({ handle: async () => ({}) })(new Request("https://nova.test/api/x"), ctx());
  assert(!get.calls.some((c) => c.startsWith("origin")), "GET skips origin guard");
});
await t("route: unexpected error → 500 generic message, details only in logs", async () => {
  const { route, logs } = makeRouter();
  const res = await route({ handle: async () => { throw new TypeError("secret internals at line 42"); } })(new Request("https://nova.test/api/x"), ctx());
  const json = await res.json();
  assert(res.status === 500 && json.error.code === "internal_error" && !JSON.stringify(json).includes("secret internals"), JSON.stringify(json));
  assert(logs.some((l) => l.includes("secret internals") && l.includes("req-1")), "logged with request id");
});
await t("route: idempotent replay returns the stored response once executed", async () => {
  const { route } = makeRouter({ user: admin });
  let runs = 0;
  const h = route({ auth: { audience: "admin" }, idempotency: { scope: () => "test" }, handle: async () => reply.created({ run: ++runs }) });
  const a = await h(post({}, { "idempotency-key": "k".repeat(20) }), ctx());
  const b = await h(post({}, { "idempotency-key": "k".repeat(20) }), ctx());
  const [ja, jb] = [await a.json(), await b.json()];
  assert(runs === 1 && a.status === 201 && b.status === 201 && jb.data.run === 1 && b.headers.get("idempotent-replayed") === "true" && ja.data.run === 1, JSON.stringify([ja, jb]));
});
await t("route: invalid JSON → 400, oversized body → 413", async () => {
  const { route } = makeRouter();
  const h = route({ body: z.object({}).passthrough(), bodyLimit: 32, handle: async () => ({}) });
  const bad = await h(new Request("https://nova.test/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" }), ctx());
  const big = await h(post({ pad: "x".repeat(100) }), ctx());
  assert(bad.status === 400 && (await bad.json()).error.code === "invalid_json" && big.status === 413, `${bad.status} ${big.status}`);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
