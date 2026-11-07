// AI module: draft parsing and prompts (pure), the model catalog (ai_models), the single AI integration (encrypted key,
// catalog-only models, provider switch, optimistic locking, audit), the health check, "AI ile ürün ekle" with a fake
// provider (system prompt per provider, images from storage, requested fields only), the three HTTP clients against a
// fake fetch (request shapes, model lookup, error mapping, retries, refusals / truncation), and the input schemas.
// No real provider is called. Run: npm run test:ai
import { makeD1 } from "./d1-sqlite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const core = await import(`${ROOT}/src/core/index.ts`);
const ai = await import(`${ROOT}/src/modules/ai/index.ts`);
const media = await import(`${ROOT}/src/modules/media/index.ts`);
const prompts = await import(`${ROOT}/src/modules/ai/prompts/system-prompts.ts`);
const clients = await import(`${ROOT}/src/modules/ai/infrastructure/ai-clients.ts`);
const { registerAudit } = await import(`${ROOT}/src/modules/audit/audit-log.ts`);
const {
  Container, D1DatabaseAdapter, DatabaseToken, ClockToken, IdGeneratorToken, LoggerToken, EnvToken, ConfigToken, FixedClock, CryptoIdGenerator, JsonLogger,
  buildConfig, toBase64,
} = core;

let pass = 0, fail = 0;
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); pass++; console.log("PASS", name); } catch (e: any) { fail++; console.log("FAIL", name, "->", e?.code ?? "", e?.message ?? e); }
}
function assert(c: unknown, m: string): asserts c { if (!c) throw new Error(m); }
async function rejects(fn: () => Promise<unknown>, code: string) {
  try { await fn(); } catch (e: any) { assert(e.code === code, `expected ${code}, got ${e.code} ${e.message}`); return e; }
  throw new Error(`expected ${code}, nothing thrown`);
}
const json = (v: unknown) => JSON.stringify(v);

// --- container: real modules; only R2, the clock and the provider client are doubles --------------
const d1 = makeD1([`${ROOT}/db/schema.sql`, `${ROOT}/db/seed.sql`]);
const objects = new Map<string, Uint8Array>();
const bucket = {
  put: async (k: string, v: Uint8Array) => { objects.set(k, v); return null; },
  get: async (k: string) => (objects.has(k) ? { body: new Response(objects.get(k)).body, httpEtag: '"e"', writeHttpMetadata() {} } : null),
  head: async () => null,
  delete: async (k: string | string[]) => { for (const x of [k].flat()) objects.delete(x); },
};
const MASTER = toBase64(crypto.getRandomValues(new Uint8Array(32)));
const clock = new FixedClock(new Date("2026-11-03T10:00:00.000Z"));

type Call = { provider: string; req: any };
const calls: Call[] = [];
let answer: (req: any) => string = () => "{}";
let modelInfo: (model: string) => any = (model) => ({ id: model, displayName: null, deprecated: false, retiresAt: null });
const fakeClients = (provider: string) => ({
  generate: async (req: any) => { calls.push({ provider, req }); return answer(req); },
  checkModel: async (apiKey: string, model: string) => { calls.push({ provider, req: { check: true, apiKey, model } }); return modelInfo(model); },
});

const root = new Container()
  .singleton(LoggerToken, () => new JsonLogger({ level: "error", sink: () => {} }))
  .singleton(ClockToken, () => clock)
  .singleton(IdGeneratorToken, () => new CryptoIdGenerator())
  .scoped(ConfigToken, (r: any) => buildConfig(r.resolve(EnvToken)))
  .scoped(DatabaseToken, (r: any) => new D1DatabaseAdapter(r.resolve(EnvToken).DB));
registerAudit(root);
media.registerMedia(root);
ai.registerAi(root);
root.singleton(ai.AiClientFactoryToken, () => fakeClients);
const resolve = (tok: any): any => root.createScope().provide(EnvToken, { DB: d1, ASSETS_BUCKET: bucket, SECRETS_MASTER_KEY: MASTER, SESSION_SECRET: "s3cret" }).resolve(tok);
const actor = { userId: "u_admin", requestId: "req-ai" };
const KEY_A = "sk-ant-test-0000000000000000000000-AAAA";
const KEY_B = "sk-openai-test-111111111111111111111-BBBB";
const auditCount = (action: string) => Number((d1.raw.prepare("SELECT count(*) AS n FROM audit_logs WHERE action = ?").get(action) as any).n);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3]);

// --- pure ------------------------------------------------------------------------------------------
await t("draft: JSON inside fences/text, only requested fields, clipped, description sanitised; garbage → null", () => {
  const text = 'İşte:\n```json\n{"name":"  Lacivert   Yün Kazak ","shortDescription":"' + "a".repeat(400) + '","descriptionHtml":"<p>Sıcak</p><script>alert(1)</script><a href=\\"javascript:x\\">t</a>","metaTitle":"T"}\n```';
  const d = ai.parseProductDraft(text, ["name", "shortDescription", "description"]);
  assert(d && d.name === "Lacivert Yün Kazak" && d.shortDescription!.length <= 300 && d.shortDescription!.endsWith("…"), json(d));
  assert(d.descriptionHtml!.includes("<p>Sıcak</p>") && !d.descriptionHtml!.includes("script") && !d.descriptionHtml!.includes("javascript"), d.descriptionHtml!);
  assert(d.seo === undefined, "seo not requested");
  assert(ai.parseProductDraft("üzgünüm, yapamam", ["name"]) === null && ai.parseProductDraft('{"other":1}', ["name"]) === null, "unusable → null");
  assert(json(ai.parseProductDraft('{"metaTitle":"Kazak","metaDescription":"Kış"}', ["seo"])) === json({ seo: { metaTitle: "Kazak", metaDescription: "Kış" } }), "seo");
});

await t("prompts: one developer system prompt per provider; user message lists only the requested JSON keys", () => {
  for (const p of ai.AI_PROVIDER_KEYS) assert(prompts.PRODUCT_CONTENT_SYSTEM_PROMPTS[p]?.includes("JSON"), `system prompt for ${p}`);
  const u = prompts.buildProductUserPrompt(["name", "seo"], "Mavi kupa", 2);
  assert(u.includes('"name"') && u.includes('"metaTitle"') && !u.includes('"descriptionHtml"') && u.includes("Mavi kupa") && u.includes("2 ürün fotoğrafı"), u);
});

// --- integration -----------------------------------------------------------------------------------
const gen = (input: any) => resolve(ai.GenerateProductContentToken).execute(input, actor);
const save = (input: any) => resolve(ai.SaveAiIntegrationToken).execute(input, actor);
const view = () => resolve(ai.GetAiIntegrationToken).execute();

await t("catalog: models per provider from ai_models, active first then deprecated, retired hidden", async () => {
  d1.raw.prepare("INSERT INTO ai_models (provider, model_id, label, status, sort_order) VALUES ('openai', 'gpt-old', 'Eski', 'retired', 1)").run();
  const c = await resolve(ai.ListAiModelsToken).execute();
  assert(ai.AI_PROVIDER_KEYS.every((p: string) => c[p].length > 0), "every provider has models");
  assert(c.anthropic[0].id === "claude-sonnet-5-5" && c.anthropic[0].status === "active", "default first: " + c.anthropic[0].id);
  const statuses = c.openai.map((m: any) => m.status);
  assert(statuses.indexOf("deprecated") > statuses.lastIndexOf("active"), "deprecated after active");
  assert(!c.openai.some((m: any) => m.id === "gpt-old"), "retired hidden");
  assert(c.gemini.find((m: any) => m.id === "gemini-2.5-flash")?.retiresAt === "2026-12-01", "retiresAt");
});

await t("no integration: view is null, generation refused with ai_not_configured", async () => {
  assert((await view()) === null, "null");
  await rejects(() => gen({ fields: ["name"], prompt: "Lacivert kazak", mediaIds: ["x"] }), "ai_not_configured");
});

let v: any;
await t("add: key required; stored encrypted (never in clear), view shows only a hint; audited", async () => {
  await rejects(() => save({ provider: "anthropic", model: "claude-sonnet-5-5", expectedUpdatedAt: null }), "validation_error");
  const unlisted = await rejects(() => save({ provider: "anthropic", model: "claude-made-up", apiKey: KEY_A, expectedUpdatedAt: null }), "validation_error");
  assert(unlisted.fieldErrors?.model, "model field error");
  await rejects(() => save({ provider: "anthropic", model: "gpt-6.1-terra", apiKey: KEY_A, expectedUpdatedAt: null }), "validation_error");
  await rejects(() => save({ provider: "openai", model: "gpt-old", apiKey: KEY_B, expectedUpdatedAt: null }), "validation_error");
  v = await save({ provider: "anthropic", model: "claude-sonnet-5-5", apiKey: KEY_A, expectedUpdatedAt: null });
  assert(v.provider === "anthropic" && v.providerLabel === "Claude" && v.keyHint === "…AAAA" && !("apiKey" in v) && v.updatedBy === "NOVA Admin", json(v));
  const row = d1.raw.prepare("SELECT * FROM ai_integration").get() as any;
  assert(!Object.values(row).some((x) => String(x).includes(KEY_A)), "key not stored in clear");
  assert(auditCount("ai_integration.create") === 1, "audited");
  const a = d1.raw.prepare("SELECT diff_redacted_json FROM audit_logs WHERE action = 'ai_integration.create'").get() as any;
  assert(!a.diff_redacted_json.includes(KEY_A), "key not in audit");
});

await t("update: stale version refused; same provider + empty key keeps the key; switching needs the new provider's key and replaces it", async () => {
  await rejects(() => save({ provider: "anthropic", model: "claude-opus-5-5", expectedUpdatedAt: null }), "ai_integration_changed");
  clock.advanceMinutes(1);
  v = await save({ provider: "anthropic", model: "claude-opus-5-5", expectedUpdatedAt: v.updatedAt });
  assert(v.model === "claude-opus-5-5" && v.keyHint === "…AAAA", json(v));
  const before = calls.length;
  const report = await resolve(ai.TestAiIntegrationToken).execute();
  const [check, gen1] = calls.slice(before);
  assert(check!.req.check && check!.req.apiKey === KEY_A && check!.req.model === "claude-opus-5-5", "health: model lookup first with the kept key");
  assert(gen1!.req.apiKey === KEY_A && gen1!.req.json === false && gen1!.req.maxTokens >= 1024, "health: tiny generation with room for thinking");
  assert(report.provider === "Claude" && report.model === "claude-opus-5-5" && report.deprecated === false && typeof report.generationMs === "number", json(report));
  clock.advanceMinutes(1);
  await rejects(() => save({ provider: "openai", model: "gpt-4.1-mini", expectedUpdatedAt: v.updatedAt }), "validation_error");
  v = await save({ provider: "openai", model: "gpt-4.1-mini", apiKey: KEY_B, expectedUpdatedAt: v.updatedAt });
  const n = (d1.raw.prepare("SELECT count(*) AS n FROM ai_integration").get() as any).n;
  assert(v.provider === "openai" && v.keyHint === "…BBBB" && n === 1, `single integration: ${n}`);
});

await t("health: deprecated model (catalog or provider) is reported with its shutdown date; a stored model that left the catalog can stay", async () => {
  let r = await resolve(ai.TestAiIntegrationToken).execute();
  assert(r.deprecated === true && r.retiresAt === "2027-01-14", "catalog deprecation: " + json(r));
  modelInfo = (model) => ({ id: model, displayName: "GPT 4.1 mini", deprecated: true, retiresAt: "2026-12-24" });
  r = await resolve(ai.TestAiIntegrationToken).execute();
  assert(r.retiresAt === "2026-12-24" && r.displayName === "GPT 4.1 mini", "provider date wins: " + json(r));
  modelInfo = (model) => ({ id: model, displayName: null, deprecated: false, retiresAt: null });
  d1.raw.prepare("UPDATE ai_models SET status = 'retired' WHERE provider = 'openai' AND model_id = 'gpt-4.1-mini'").run();
  clock.advanceMinutes(1);
  v = await save({ provider: "openai", model: "gpt-4.1-mini", apiKey: KEY_B, expectedUpdatedAt: v.updatedAt });
  assert(v.model === "gpt-4.1-mini", "key rotation keeps the stored model");
  d1.raw.prepare("UPDATE ai_models SET status = 'deprecated' WHERE provider = 'openai' AND model_id = 'gpt-4.1-mini'").run();
});

let img1 = "", img2 = "";
await t("generate: active provider's system prompt, photos from storage as base64, only requested fields back; audited", async () => {
  const up = resolve(media.UploadImageToken);
  img1 = (await up.execute({ bytes: PNG, fileName: "on.png", folder: "products" }, actor)).id;
  img2 = (await up.execute({ bytes: PNG, fileName: "arka.png", folder: "products" }, actor)).id;
  answer = () => '```json\n{"name":"Lacivert Yün Kazak","shortDescription":"Kış için sıcak.","descriptionHtml":"<p>Yumuşak</p>","metaTitle":"İstenmedi"}\n```';
  const before = calls.length;
  const r = await gen({ fields: ["name", "shortDescription", "description", "images"], prompt: "Erkek yün kazak, lacivert", mediaIds: [img1, img2] });
  const c = calls.at(-1)!;
  assert(calls.length === before + 1 && c.provider === "openai" && c.req.apiKey === KEY_B && c.req.json === true, json(c.provider));
  assert(c.req.system === prompts.PRODUCT_CONTENT_SYSTEM_PROMPTS.openai, "developer system prompt of the active provider");
  assert(c.req.images.length === 2 && c.req.images[0].mime === "image/png" && c.req.images[0].base64 === toBase64(PNG), "images");
  assert(c.req.text.includes("Erkek yün kazak") && !c.req.text.includes("metaTitle"), "user prompt");
  assert(json(r.draft) === json({ name: "Lacivert Yün Kazak", shortDescription: "Kış için sıcak.", descriptionHtml: "<p>Yumuşak</p>" }) && r.providerLabel === "OpenAI", json(r));
  assert(auditCount("ai.product_generate") === 1, "audited");
  assert((d1.raw.prepare("SELECT count(*) AS n FROM products WHERE name = 'Lacivert Yün Kazak'").get() as any).n === 0, "nothing saved to products");
});

await t("generate: images-only needs no provider call; AVIF / missing images refused; useless answer → ai_bad_output", async () => {
  const before = calls.length;
  const r = await gen({ fields: ["images"], prompt: "Erkek yün kazak", mediaIds: [img1] });
  assert(calls.length === before && json(r.draft) === "{}", "no call");
  objects.set("products/avif1.avif", new Uint8Array([1, 2, 3]));
  d1.raw.prepare("INSERT INTO media_assets (id, storage_key, public_url, mime_type, byte_size) VALUES ('m_avif', 'products/avif1.avif', '/assets/products/avif1.avif', 'image/avif', 3)").run();
  await rejects(() => gen({ fields: ["name"], prompt: "Erkek yün kazak", mediaIds: ["m_avif"] }), "validation_error");
  await rejects(() => gen({ fields: ["name"], prompt: "Erkek yün kazak", mediaIds: ["m_yok"] }), "validation_error");
  answer = () => "Bu görselde ürün göremiyorum.";
  await rejects(() => gen({ fields: ["name"], prompt: "Erkek yün kazak", mediaIds: [img1] }), "ai_bad_output");
});

await t("remove: guarded by version; afterwards generation is refused again", async () => {
  await rejects(() => resolve(ai.RemoveAiIntegrationToken).execute("2000-01-01T00:00:00.000Z", actor), "ai_integration_changed");
  await resolve(ai.RemoveAiIntegrationToken).execute(v.updatedAt, actor);
  assert((await view()) === null && auditCount("ai_integration.delete") === 1, "removed + audited");
  await rejects(() => gen({ fields: ["name"], prompt: "Erkek yün kazak", mediaIds: [img1] }), "ai_not_configured");
});

// --- HTTP clients against a fake fetch -------------------------------------------------------------
const req = { model: "m-1", apiKey: "KEY-123", system: "SYS", text: "TXT", images: [{ mime: "image/png", base64: "QUJD" }], maxTokens: 100, json: true };
function fakeFetch(status: number, body: unknown) {
  const seen: { url: string; init: any }[] = [];
  const fn = async (url: string, init: any) => { seen.push({ url, init }); return new Response(typeof body === "string" ? body : JSON.stringify(body), { status }); };
  return { fn, seen };
}

await t("clients: request shape per provider (URL, auth header, system prompt, image), key only in headers", async () => {
  const o = fakeFetch(200, { choices: [{ message: { content: '{"name":"A"}' } }] });
  assert((await new clients.OpenAiClient(o.fn).generate(req)) === '{"name":"A"}', "openai text");
  let b = JSON.parse(o.seen[0]!.init.body);
  assert(o.seen[0]!.url === "https://api.openai.com/v1/chat/completions" && o.seen[0]!.init.headers.authorization === "Bearer KEY-123", "openai url/auth");
  assert(b.messages[0].content === "SYS" && b.messages[1].content[1].image_url.url === "data:image/png;base64,QUJD" && b.response_format.type === "json_object", "openai body");

  const g = fakeFetch(200, { candidates: [{ content: { parts: [{ text: '{"name":' }, { text: '"B"}' }] } }] });
  assert((await new clients.GeminiClient(g.fn).generate(req)) === '{"name":"B"}', "gemini text");
  b = JSON.parse(g.seen[0]!.init.body);
  assert(g.seen[0]!.url.endsWith("/models/m-1:generateContent") && g.seen[0]!.init.headers["x-goog-api-key"] === "KEY-123", "gemini url/auth");
  assert(b.systemInstruction.parts[0].text === "SYS" && b.contents[0].parts[0].inlineData.data === "QUJD" && b.generationConfig.responseMimeType === "application/json", "gemini body");

  const a = fakeFetch(200, { content: [{ type: "text", text: '{"name":"C"}' }] });
  assert((await new clients.AnthropicClient(a.fn).generate(req)) === '{"name":"C"}', "anthropic text");
  b = JSON.parse(a.seen[0]!.init.body);
  assert(a.seen[0]!.url === "https://api.anthropic.com/v1/messages" && a.seen[0]!.init.headers["x-api-key"] === "KEY-123" && a.seen[0]!.init.headers["anthropic-version"], "anthropic url/auth");
  assert(b.system === "SYS" && b.messages[0].content[0].source.data === "QUJD" && b.max_tokens === 100, "anthropic body");
  for (const s of [o, g, a]) assert(!String(s.seen[0]!.init.body).includes("KEY-123"), "key never in body");
});

await t("clients: 401 → ai_key_rejected, 429 → ai_rate_limited, 500 / network → ai_provider_error (no provider text exposed)", async () => {
  await rejects(() => new clients.AnthropicClient(fakeFetch(401, { type: "error", error: { type: "authentication_error" } }).fn).generate(req), "ai_key_rejected");
  await rejects(() => new clients.GeminiClient(fakeFetch(400, { error: { status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }).fn).generate(req), "ai_key_rejected");
  await rejects(() => new clients.OpenAiClient(fakeFetch(429, { error: { type: "rate_limit" } }).fn).generate(req), "ai_rate_limited");
  const e = await rejects(() => new clients.OpenAiClient(fakeFetch(500, "secret upstream detail").fn, [0, 0]).generate(req), "ai_provider_error");
  assert(!e.message.includes("secret upstream detail"), "provider text not exposed");
  await rejects(() => new clients.OpenAiClient(async () => { throw new TypeError("fetch failed"); }).generate(req), "ai_provider_error");
  await rejects(() => new clients.OpenAiClient(async () => { throw new DOMException("timed out", "TimeoutError"); }).generate(req), "ai_timeout");
});

await t("clients: error mapping per the providers' docs (money vs rate limit, key vs permission, region, model, size, bad request)", () => {
  const cases: [number, unknown, string][] = [
    [429, { error: { type: "insufficient_quota", code: "insufficient_quota" } }, "ai_quota_exceeded"], // OpenAI credits / quota
    [429, { error: { code: "organization_spend_limit_exceeded" } }, "ai_quota_exceeded"],
    [429, { error: { type: "rate_limit_error", code: "slow_down" } }, "ai_rate_limited"],
    [402, { type: "error", error: { type: "billing_error" } }, "ai_quota_exceeded"], // Claude billing
    [400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, "ai_quota_exceeded"],
    [429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel" } }, "ai_quota_exceeded"], // Gemini daily
    [429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: GenerateRequestsPerMinutePerProjectPerModel" } }, "ai_rate_limited"],
    [403, { error: { status: "PERMISSION_DENIED", message: "Your API key was reported as leaked. Please use another API key." } }, "ai_key_rejected"],
    [403, { type: "error", error: { type: "permission_error" } }, "ai_access_denied"],
    [403, { error: { code: "unsupported_country_region_territory" } }, "ai_access_denied"],
    [400, { error: { status: "FAILED_PRECONDITION", message: "User location is not supported for the API use." } }, "ai_access_denied"],
    [401, { error: { code: "invalid_api_key" } }, "ai_key_rejected"],
    [404, { type: "error", error: { type: "not_found_error" } }, "ai_model_not_found"],
    [413, { type: "error", error: { type: "request_too_large" } }, "ai_request_too_large"],
    [400, { error: { type: "invalid_request_error", message: "Invalid image" } }, "ai_request_rejected"],
    [529, { type: "error", error: { type: "overloaded_error" } }, "ai_provider_busy"],
    [500, { type: "error", error: { type: "api_error" } }, "ai_provider_error"],
  ];
  for (const [status, body, code] of cases) {
    const e = clients.classifyFailure(status, JSON.stringify(body));
    assert(e.code === code, `${status} ${json(body)} → ${e.code}, expected ${code}`);
    assert(!e.message.includes("Anthropic API") && !e.message.includes("leaked"), "provider text not exposed");
  }
});

await t("clients: refusals → ai_content_blocked; token limit → ai_output_truncated for JSON (plain test answer may be cut); thinking blocks ignored", async () => {
  const jsonReq = { ...req, json: true }, textReq = { ...req, json: false };
  await rejects(() => new clients.OpenAiClient(fakeFetch(200, { choices: [{ finish_reason: "stop", message: { content: null, refusal: "I can't help" } }] }).fn).generate(jsonReq), "ai_content_blocked");
  await rejects(() => new clients.OpenAiClient(fakeFetch(200, { choices: [{ finish_reason: "length", message: { content: '{"name":"A' } }] }).fn).generate(jsonReq), "ai_output_truncated");
  assert((await new clients.OpenAiClient(fakeFetch(200, { choices: [{ finish_reason: "length", message: { content: "O" } }] }).fn).generate(textReq)) === "O", "plain cut answer ok");
  await rejects(() => new clients.GeminiClient(fakeFetch(200, { promptFeedback: { blockReason: "SAFETY" } }).fn).generate(jsonReq), "ai_content_blocked");
  await rejects(() => new clients.GeminiClient(fakeFetch(200, { candidates: [{ finishReason: "PROHIBITED_CONTENT", content: { parts: [] } }] }).fn).generate(jsonReq), "ai_content_blocked");
  await rejects(() => new clients.GeminiClient(fakeFetch(200, { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "", thought: true }] } }] }).fn).generate(textReq), "ai_output_truncated");
  assert((await new clients.GeminiClient(fakeFetch(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "düşünce", thought: true }, { text: "OK" }] } }] }).fn).generate(textReq)) === "OK", "gemini thought parts skipped");
  await rejects(() => new clients.AnthropicClient(fakeFetch(200, { stop_reason: "refusal", content: [] }).fn).generate(jsonReq), "ai_content_blocked");
  await rejects(() => new clients.AnthropicClient(fakeFetch(200, { stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "..." }] }).fn).generate(textReq), "ai_output_truncated");
  assert((await new clients.AnthropicClient(fakeFetch(200, { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "OK" }] }).fn).generate(textReq)) === "OK", "claude thinking skipped");
});

await t("clients: health check = GET on each provider's models endpoint (no body, key in header); unusable / retired / deprecated models", async () => {
  const o = fakeFetch(200, { id: "gpt-x", object: "model", shutdown_date: "2027-01-14" });
  const oi = await new clients.OpenAiClient(o.fn).checkModel("KEY-123", "gpt-x");
  assert(o.seen[0]!.url === "https://api.openai.com/v1/models/gpt-x" && o.seen[0]!.init.method === "GET" && !o.seen[0]!.init.body && o.seen[0]!.init.headers.authorization === "Bearer KEY-123", "openai GET");
  assert(oi.deprecated && oi.retiresAt === "2027-01-14", json(oi));
  const g = fakeFetch(200, { name: "models/gemini-x", baseModelId: "gemini-x", displayName: "Gemini X", supportedGenerationMethods: ["generateContent", "countTokens"] });
  const gi = await new clients.GeminiClient(g.fn).checkModel("KEY-123", "models/gemini-x");
  assert(g.seen[0]!.url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-x" && g.seen[0]!.init.headers["x-goog-api-key"] === "KEY-123" && gi.displayName === "Gemini X", "gemini GET");
  await rejects(() => new clients.GeminiClient(fakeFetch(200, { name: "models/embed", supportedGenerationMethods: ["embedContent"] }).fn).checkModel("K", "embed"), "ai_model_unusable");
  const a = fakeFetch(200, { id: "claude-x", display_name: "Claude X", lifecycle: "deprecated", retires_at: "2027-03-01T00:00:00Z" });
  const ai2 = await new clients.AnthropicClient(a.fn).checkModel("KEY-123", "claude-x");
  assert(a.seen[0]!.url === "https://api.anthropic.com/v1/models/claude-x" && a.seen[0]!.init.headers["x-api-key"] === "KEY-123" && ai2.deprecated && ai2.retiresAt === "2027-03-01", json(ai2));
  await rejects(() => new clients.AnthropicClient(fakeFetch(200, { id: "claude-old", lifecycle: "retired" }).fn).checkModel("K", "claude-old"), "ai_model_unusable");
  await rejects(() => new clients.AnthropicClient(fakeFetch(401, { type: "error", error: { type: "authentication_error" } }).fn).checkModel("K", "claude-x"), "ai_key_rejected");
  await rejects(() => new clients.OpenAiClient(fakeFetch(404, { error: { code: "model_not_found" } }).fn).checkModel("K", "gpt-nope"), "ai_model_not_found");
  let n = 0;
  await rejects(() => new clients.GeminiClient(async () => { n++; return new Response("{}", { status: 503 }); }).checkModel("K", "g"), "ai_provider_busy");
  assert(n === 1, "model lookup is not retried");
});

await t("clients: 503 retried then succeeds; still overloaded → ai_provider_busy; 404 → ai_model_not_found", async () => {
  const answers = [503, 503, 200];
  let calls = 0;
  const flaky = async () => {
    const status = answers[calls++]!;
    return new Response(JSON.stringify(status === 200 ? { candidates: [{ content: { parts: [{ text: "ok" }] } }] } : { error: { status: "UNAVAILABLE" } }), { status });
  };
  assert((await new clients.GeminiClient(flaky, [0, 0]).generate(req)) === "ok" && calls === 3, `retried (${calls})`);
  calls = 0;
  const busy = await rejects(() => new clients.GeminiClient(async () => { calls++; return new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 }); }, [0, 0]).generate(req), "ai_provider_busy");
  assert(calls === 3 && busy.message.includes("yoğun") && busy.details.attempts === 3, `${calls} ${busy.message}`);
  calls = 0;
  await rejects(() => new clients.AnthropicClient(async () => { calls++; return new Response('{"type":"error","error":{"type":"overloaded_error"}}', { status: 529 }); }, [0]).generate(req), "ai_provider_busy");
  assert(calls === 2, "529 retried");
  await rejects(() => new clients.GeminiClient(fakeFetch(404, { error: { status: "NOT_FOUND" } }).fn).generate(req), "ai_model_not_found");
  await rejects(() => new clients.OpenAiClient(fakeFetch(400, { error: { code: "model_not_found" } }).fn).generate(req), "ai_model_not_found");
});

// --- schemas ---------------------------------------------------------------------------------------
await t("schemas: provider/model/key rules; generation needs 1–2 images, ≥1 field, a real description", () => {
  const s = ai.aiIntegrationSchema;
  assert(!s.safeParse({ provider: "mistral", model: "m-1", expectedUpdatedAt: null }).success, "unknown provider");
  assert(!s.safeParse({ provider: "openai", model: "gpt 4", expectedUpdatedAt: null }).success, "model with space");
  assert(!s.safeParse({ provider: "openai", model: "gpt-4.1", apiKey: "short", expectedUpdatedAt: null }).success, "short key");
  assert(s.parse({ provider: "openai", model: "gpt-4.1", apiKey: "", expectedUpdatedAt: null }).apiKey === undefined, "empty key = keep");
  const g = ai.aiProductGenerateSchema;
  assert(!g.safeParse({ fields: [], prompt: "Erkek yün kazak", mediaIds: ["a"] }).success, "no fields");
  assert(!g.safeParse({ fields: ["name"], prompt: "kazak", mediaIds: ["a"] }).success, "short prompt");
  assert(!g.safeParse({ fields: ["name"], prompt: "Erkek yün kazak", mediaIds: [] }).success, "no image");
  assert(!g.safeParse({ fields: ["name"], prompt: "Erkek yün kazak", mediaIds: ["a", "b", "c"] }).success, "3 images");
  assert(json(g.parse({ fields: ["name", "name"], prompt: "Erkek yün kazak", mediaIds: ["a"] }).fields) === json(["name"]), "dedupe");
});

console.log(`${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
