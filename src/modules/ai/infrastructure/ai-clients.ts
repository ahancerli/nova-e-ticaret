import type { AppError } from "@/core";
import type { AiChatRequest, AiChatTurn, AiClientFactory, AiModelInfo, AiRequest, AiTextClient, AiToolCall } from "../application/ports";
import { AiErrors } from "../domain/errors";
import type { AiProvider } from "../domain/providers";

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/** Whole budget of one generation incl. retries — stays under the panel's 75 s client timeout. */
const GENERATE_TIMEOUT_MS = 60_000;
const CHECK_TIMEOUT_MS = 15_000;
/** Waits before retrying a transient failure ("model overloaded" is temporary; all three providers ask clients to retry). */
export const RETRY_DELAYS_MS = [1_000, 3_000];
const RETRY_STATUSES = [500, 502, 503, 504, 529];
/** 529 = Anthropic overloaded_error. */
const BUSY_STATUSES = [502, 503, 504, 529];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** The provider's error type/code token (e.g. `insufficient_quota`, `RESOURCE_EXHAUSTED`) — safe for logs. */
function errorType(text: string): string | undefined {
  try {
    const e = (JSON.parse(text) as Obj).error as Obj | undefined;
    const t = str(e?.code) ?? str(e?.type) ?? str(e?.status);
    if (t && /^[A-Za-z_]{1,60}$/.test(t)) return t;
  } catch { /* not JSON */ }
  return undefined;
}

// Matched against the raw error body, which never leaves the server. Sources: the providers' error docs (2026-11).
const QUOTA = /insufficient_quota|credit_balance|credit balance|billing|payment_required|spend[_ ]limit|usage[_ ]limit|quota_exceeded|PerDay/i;
const BAD_KEY = /API_KEY_INVALID|API key not valid|invalid[_ ]api[_ ]key|incorrect api key|authentication_error|"authentication"|reported as leaked|API key expired/i;
const REGION = /location is not supported|unsupported_country|country, region/i;
const NO_MODEL = /not_found_error|"NOT_FOUND"|"not_found"|model_not_found|does not exist/i;

/**
 * Provider HTTP failure → AiErrors. Order matters: money and key problems first (a Gemini bad key is a 400, a
 * spent Claude account is a 400 too), then status classes. Exported for tests.
 */
export function classifyFailure(status: number, text: string): AppError {
  const details = { status, type: errorType(text) };
  if (status === 402 || ((status === 400 || status === 403 || status === 429) && QUOTA.test(text))) return AiErrors.quotaExceeded(details);
  if (status === 401 || ((status === 400 || status === 403) && BAD_KEY.test(text))) return AiErrors.keyRejected(details);
  if (status === 403 || (status === 400 && REGION.test(text))) return AiErrors.accessDenied(details);
  if (status === 404 || (status === 400 && NO_MODEL.test(text))) return AiErrors.modelNotFound(details);
  if (status === 413) return AiErrors.requestTooLarge();
  if (status === 429) return AiErrors.rateLimited(details);
  if (status === 400 || status === 422) return AiErrors.requestRejected(details);
  if (status === 408) return AiErrors.timeout();
  if (BUSY_STATUSES.includes(status)) return AiErrors.providerBusy(details);
  return AiErrors.providerFailed(details);
}

/**
 * One JSON call to a provider; failures mapped by `classifyFailure`. 500/502/503/504/529 are retried after `delays`
 * while the time budget allows. The API key is only ever sent as a header; neither the key nor the provider's error
 * body reaches logs or the client (only status + the provider's error type).
 */
async function call(
  fetchFn: FetchFn, method: "GET" | "POST", url: string, headers: Record<string, string>, body: unknown,
  opts: { delays: number[]; timeoutMs: number },
): Promise<Obj> {
  const deadline = Date.now() + opts.timeoutMs;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchFn(url, {
        method,
        headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "network";
      throw name === "TimeoutError" || name === "AbortError" ? AiErrors.timeout() : AiErrors.providerFailed({ reason: name });
    }
    const text = await res.text();
    if (res.ok) {
      try {
        const out: unknown = JSON.parse(text);
        if (out && typeof out === "object") return out as Obj;
      } catch { /* fall through */ }
      throw AiErrors.badOutput();
    }
    const delay = opts.delays[attempt];
    if (!RETRY_STATUSES.includes(res.status) || delay === undefined || Date.now() + delay >= deadline) {
      const err = classifyFailure(res.status, text);
      if (attempt > 0) err.details.attempts = attempt + 1;
      throw err;
    }
    await sleep(delay);
  }
}

/** Shared ending of `generate`: refused / truncated / empty answers become distinct errors. */
function answerText(text: string, finish: { blocked: boolean; truncated: boolean; reason?: unknown }, json: boolean): string {
  if (finish.blocked) throw AiErrors.contentBlocked({ reason: finish.reason });
  // A cut-off JSON object is useless; a cut-off plain answer (connection test) still proves the call works.
  if (finish.truncated && (json || !text.trim())) throw AiErrors.outputTruncated({ reason: finish.reason });
  if (!text.trim()) throw AiErrors.badOutput();
  return text;
}

const day = (v: unknown) => str(v)?.slice(0, 10) ?? null;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});

/** Tool arguments arrive as a JSON string (OpenAI) or an object; anything else counts as "no arguments". */
function toolInput(v: unknown): Obj {
  if (typeof v !== "string") return obj(v);
  try { return obj(JSON.parse(v)); } catch { return {}; }
}

/** Shared ending of `converse`: a turn must carry text or tool calls. */
function chatTurn(turn: AiChatTurn, finish: { blocked: boolean; truncated: boolean; reason?: unknown }): AiChatTurn {
  if (finish.blocked) throw AiErrors.contentBlocked({ reason: finish.reason });
  if (!turn.toolCalls.length && !turn.text.trim()) throw finish.truncated ? AiErrors.outputTruncated({ reason: finish.reason }) : AiErrors.badOutput();
  return turn;
}

/** OpenAI Chat Completions: system + user message with image_url data URLs, JSON mode. */
export class OpenAiClient implements AiTextClient {
  constructor(private readonly fetchFn: FetchFn, private readonly delays: number[] = RETRY_DELAYS_MS) {}

  async generate(req: AiRequest): Promise<string> {
    const out = await call(this.fetchFn, "POST", "https://api.openai.com/v1/chat/completions", { authorization: `Bearer ${req.apiKey}` }, {
      model: req.model,
      max_completion_tokens: req.maxTokens,
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: req.system },
        {
          role: "user",
          content: [
            { type: "text", text: req.text },
            ...req.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.base64}` } })),
          ],
        },
      ],
    }, { delays: this.delays, timeoutMs: GENERATE_TIMEOUT_MS });
    const choice = arr(out.choices)[0];
    const message = choice?.message as Obj | undefined;
    const reason = choice?.finish_reason;
    return answerText(str(message?.content) ?? "", { blocked: !!str(message?.refusal) || reason === "content_filter", truncated: reason === "length", reason }, req.json);
  }

  /** Chat Completions function calling: `tools[].function`, assistant `tool_calls`, one `role: tool` message per result. */
  async converse(req: AiChatRequest): Promise<AiChatTurn> {
    const messages: Obj[] = [{ role: "system", content: req.system }];
    for (const m of req.messages) {
      if (m.role === "user") messages.push({ role: "user", content: m.text });
      else if (m.role === "assistant") {
        messages.push({
          role: "assistant", content: m.text || null,
          ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}),
        });
      } else for (const r of m.results) messages.push({ role: "tool", tool_call_id: r.id, content: r.output });
    }
    const out = await call(this.fetchFn, "POST", "https://api.openai.com/v1/chat/completions", { authorization: `Bearer ${req.apiKey}` }, {
      model: req.model, max_completion_tokens: req.maxTokens, messages,
      ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
    }, { delays: this.delays, timeoutMs: GENERATE_TIMEOUT_MS });
    const choice = arr(out.choices)[0];
    const message = obj(choice?.message);
    const reason = choice?.finish_reason;
    const toolCalls: AiToolCall[] = arr(message.tool_calls).flatMap((c, i) => {
      const fn = obj(c.function);
      const name = str(fn.name);
      return name ? [{ id: str(c.id) ?? `call_${i}`, name, input: toolInput(fn.arguments) }] : [];
    });
    const usage = obj(out.usage);
    return chatTurn(
      { text: str(message.content) ?? "", toolCalls, usage: { inputTokens: num(usage.prompt_tokens), outputTokens: num(usage.completion_tokens) }, raw: null },
      { blocked: !!str(message.refusal) || reason === "content_filter", truncated: reason === "length", reason },
    );
  }

  async checkModel(apiKey: string, model: string): Promise<AiModelInfo> {
    const out = await call(this.fetchFn, "GET", `https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { authorization: `Bearer ${apiKey}` }, undefined,
      { delays: [], timeoutMs: CHECK_TIMEOUT_MS });
    const retiresAt = day(out.shutdown_date);
    return { id: str(out.id) ?? model, displayName: null, deprecated: !!retiresAt, retiresAt };
  }
}

/** Gemini finish reasons that mean "a filter stopped the answer". */
const GEMINI_BLOCKED = ["SAFETY", "RECITATION", "LANGUAGE", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"];
/** Model ids are sent bare; tolerate the "models/…" resource form the Gemini docs also use. */
const geminiModel = (model: string) => encodeURIComponent(model.replace(/^models\//, ""));

/** Google Gemini generateContent: systemInstruction + inline image parts, JSON response MIME type. */
export class GeminiClient implements AiTextClient {
  constructor(private readonly fetchFn: FetchFn, private readonly delays: number[] = RETRY_DELAYS_MS) {}

  async generate(req: AiRequest): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel(req.model)}:generateContent`;
    const out = await call(this.fetchFn, "POST", url, { "x-goog-api-key": req.apiKey }, {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [...req.images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } })), { text: req.text }] }],
      generationConfig: { maxOutputTokens: req.maxTokens, ...(req.json ? { responseMimeType: "application/json" } : {}) },
    }, { delays: this.delays, timeoutMs: GENERATE_TIMEOUT_MS });
    const blockReason = (out.promptFeedback as Obj | undefined)?.blockReason;
    const candidate = arr(out.candidates)[0];
    const reason = blockReason ?? candidate?.finishReason;
    // Thought-summary parts (thinking models) are not part of the answer.
    const text = arr((candidate?.content as Obj | undefined)?.parts).map((p) => (p.thought === true ? "" : str(p.text) ?? "")).join("");
    return answerText(text, { blocked: !!blockReason || GEMINI_BLOCKED.includes(String(reason)), truncated: reason === "MAX_TOKENS", reason }, req.json);
  }

  /**
   * Function calling: `tools[].functionDeclarations`, model `functionCall` parts, `functionResponse` parts back. The
   * model's parts are replayed untouched inside one tool loop (thinking models attach a thought signature to them).
   */
  async converse(req: AiChatRequest): Promise<AiChatTurn> {
    const contents: Obj[] = [];
    for (const m of req.messages) {
      if (m.role === "user") contents.push({ role: "user", parts: [{ text: m.text }] });
      else if (m.role === "assistant") {
        const parts = Array.isArray(m.raw) ? m.raw : [
          ...(m.text ? [{ text: m.text }] : []),
          ...(m.toolCalls ?? []).map((c) => ({ functionCall: { name: c.name, args: c.input } })),
        ];
        if (parts.length) contents.push({ role: "model", parts });
      } else contents.push({ role: "user", parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: { result: r.output } } })) });
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel(req.model)}:generateContent`;
    const out = await call(this.fetchFn, "POST", url, { "x-goog-api-key": req.apiKey }, {
      systemInstruction: { parts: [{ text: req.system }] },
      contents,
      ...(req.tools.length ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }] } : {}),
      generationConfig: { maxOutputTokens: req.maxTokens },
    }, { delays: this.delays, timeoutMs: GENERATE_TIMEOUT_MS });
    const blockReason = obj(out.promptFeedback).blockReason;
    const candidate = arr(out.candidates)[0];
    const reason = blockReason ?? candidate?.finishReason;
    const parts = arr(obj(candidate?.content).parts);
    const toolCalls: AiToolCall[] = parts.flatMap((p, i) => {
      const fc = obj(p.functionCall);
      const name = str(fc.name);
      return name ? [{ id: str(fc.id) ?? `call_${i}`, name, input: obj(fc.args) }] : [];
    });
    const usage = obj(out.usageMetadata);
    return chatTurn(
      {
        text: parts.map((p) => (p.thought === true ? "" : str(p.text) ?? "")).join(""), toolCalls,
        usage: { inputTokens: num(usage.promptTokenCount), outputTokens: num(usage.candidatesTokenCount) + num(usage.thoughtsTokenCount) }, raw: parts,
      },
      { blocked: !!blockReason || GEMINI_BLOCKED.includes(String(reason)), truncated: reason === "MAX_TOKENS", reason },
    );
  }

  async checkModel(apiKey: string, model: string): Promise<AiModelInfo> {
    const out = await call(this.fetchFn, "GET", `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel(model)}`, { "x-goog-api-key": apiKey }, undefined,
      { delays: [], timeoutMs: CHECK_TIMEOUT_MS });
    const methods = out.supportedGenerationMethods;
    if (Array.isArray(methods) && !methods.includes("generateContent")) throw AiErrors.modelUnusable({ methods: methods.join(",") });
    return { id: str(out.baseModelId) ?? model, displayName: str(out.displayName), deprecated: false, retiresAt: null };
  }
}

const ANTHROPIC_HEADERS = (apiKey: string) => ({ "x-api-key": apiKey, "anthropic-version": "2026-10-21" });

/** Anthropic Messages API: system prompt + base64 image blocks (no JSON mode; the prompt asks for JSON only). */
export class AnthropicClient implements AiTextClient {
  constructor(private readonly fetchFn: FetchFn, private readonly delays: number[] = RETRY_DELAYS_MS) {}

  async generate(req: AiRequest): Promise<string> {
    const out = await call(this.fetchFn, "POST", "https://api.anthropic.com/v1/messages", ANTHROPIC_HEADERS(req.apiKey), {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{
        role: "user",
        content: [
          ...req.images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.base64 } })),
          { type: "text", text: req.text },
        ],
      }],
    }, { delays: this.delays, timeoutMs: GENERATE_TIMEOUT_MS });
    // Thinking blocks (always on for Opus 5.5 / Fable 5.1) are skipped; only text blocks are the answer.
    const text = arr(out.content).filter((b) => b.type === "text").map((b) => str(b.text) ?? "").join("");
    const reason = out.stop_reason;
    return answerText(text, { blocked: reason === "refusal", truncated: reason === "max_tokens", reason }, req.json);
  }

  /**
   * Tool use: `tools[].input_schema`, `tool_use` blocks, all `tool_result` blocks of a turn in ONE user message. The
   * assistant content of the running loop is sent back unchanged — thinking blocks must not be edited or dropped.
   */
  async converse(req: AiChatRequest): Promise<AiChatTurn> {
    const messages: Obj[] = [];
    for (const m of req.messages) {
      if (m.role === "user") messages.push({ role: "user", content: m.text });
      else if (m.role === "assistant") {
        const content = Array.isArray(m.raw) ? m.raw : [
          ...(m.text ? [{ type: "text", text: m.text }] : []),
          ...(m.toolCalls ?? []).map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
        ];
        if (content.length) messages.push({ role: "assistant", content });
      } else {
        messages.push({ role: "user", content: m.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.output, ...(r.isError ? { is_error: true } : {}) })) });
      }
    }
    const out = await call(this.fetchFn, "POST", "https://api.anthropic.com/v1/messages", ANTHROPIC_HEADERS(req.apiKey), {
      model: req.model, max_tokens: req.maxTokens, system: req.system, messages,
      ...(req.tools.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
    }, { delays: this.delays, timeoutMs: GENERATE_TIMEOUT_MS });
    const content = arr(out.content);
    const toolCalls: AiToolCall[] = content.flatMap((b) => {
      const id = str(b.id), name = str(b.name);
      return b.type === "tool_use" && id && name ? [{ id, name, input: obj(b.input) }] : [];
    });
    const reason = out.stop_reason;
    const usage = obj(out.usage);
    return chatTurn(
      {
        text: content.filter((b) => b.type === "text").map((b) => str(b.text) ?? "").join(""), toolCalls,
        usage: { inputTokens: num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens), outputTokens: num(usage.output_tokens) }, raw: content,
      },
      { blocked: reason === "refusal", truncated: reason === "max_tokens", reason },
    );
  }

  async checkModel(apiKey: string, model: string): Promise<AiModelInfo> {
    const out = await call(this.fetchFn, "GET", `https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, ANTHROPIC_HEADERS(apiKey), undefined,
      { delays: [], timeoutMs: CHECK_TIMEOUT_MS });
    if (out.lifecycle === "retired") throw AiErrors.modelUnusable({ lifecycle: "retired" });
    return { id: str(out.id) ?? model, displayName: str(out.display_name), deprecated: out.lifecycle === "deprecated", retiresAt: day(out.retires_at) };
  }
}

/** Provider → client (Strategy registry). A new provider = one class + one line here. */
export function httpAiClients(fetchFn: FetchFn = (input, init) => fetch(input, init)): AiClientFactory {
  const clients: Record<AiProvider, AiTextClient> = {
    openai: new OpenAiClient(fetchFn),
    gemini: new GeminiClient(fetchFn),
    anthropic: new AnthropicClient(fetchFn),
  };
  return (provider) => clients[provider];
}
