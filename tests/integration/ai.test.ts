// AI module: draft parsing and prompts (pure), the single AI integration (encrypted key, provider switch, optimistic
// locking, audit), "AI ile ürün ekle" with a fake provider (system prompt per provider, images from storage,
// requested fields only), the three HTTP clients against a fake fetch, and the input schemas.
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
const fakeClients = (provider: string) => ({ generate: async (req: any) => { calls.push({ provider, req }); return answer(req); } });

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

await t("no integration: view is null, generation refused with ai_not_configured", async () => {
  assert((await view()) === null, "null");
  await rejects(() => gen({ fields: ["name"], prompt: "Lacivert kazak", mediaIds: ["x"] }), "ai_not_configured");
});

let v: any;
await t("add: key required; stored encrypted (never in clear), view shows only a hint; audited", async () => {
  await rejects(() => save({ provider: "anthropic", model: "claude-sonnet-5-5", expectedUpdatedAt: null }), "validation_error");
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
  await resolve(ai.TestAiIntegrationToken).execute();
  assert(calls.at(-1)!.req.apiKey === KEY_A && calls.at(-1)!.req.model === "claude-opus-5-5", "kept key decrypts");
  clock.advanceMinutes(1);
  await rejects(() => save({ provider: "openai", model: "gpt-4.1-mini", expectedUpdatedAt: v.updatedAt }), "validation_error");
  v = await save({ provider: "openai", model: "gpt-4.1-mini", apiKey: KEY_B, expectedUpdatedAt: v.updatedAt });
  const n = (d1.raw.prepare("SELECT count(*) AS n FROM ai_integration").get() as any).n;
  assert(v.provider === "openai" && v.keyHint === "…BBBB" && n === 1, `single integration: ${n}`);
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
  const e = await rejects(() => new clients.OpenAiClient(fakeFetch(500, "secret upstream detail").fn).generate(req), "ai_provider_error");
  assert(!e.message.includes("secret upstream detail"), "provider text not exposed");
  await rejects(() => new clients.OpenAiClient(async () => { throw new TypeError("fetch failed"); }).generate(req), "ai_provider_error");
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
