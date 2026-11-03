import type { AiClientFactory, AiRequest, AiTextClient } from "../application/ports";
import { AiErrors } from "../domain/errors";
import type { AiProvider } from "../domain/providers";

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 60_000;

/**
 * POST JSON to a provider and map failures to AiErrors. The API key is only ever sent as a header; neither the
 * key nor the provider's error body reaches logs or the client (only status + the provider's error type).
 */
async function post(fetchFn: FetchFn, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw AiErrors.providerFailed({ reason: err instanceof Error ? err.name : "network" });
  }
  const text = await res.text();
  if (res.ok) {
    try {
      return JSON.parse(text);
    } catch {
      throw AiErrors.badOutput();
    }
  }
  if (res.status === 401 || res.status === 403 || res.status === 404 || /API_KEY_INVALID|invalid[_ ]api[_ ]key/i.test(text)) throw AiErrors.keyRejected();
  if (res.status === 429) throw AiErrors.rateLimited();
  throw AiErrors.providerFailed({ status: res.status, type: /"(?:type|status)"\s*:\s*"([a-zA-Z_]+)"/.exec(text)?.[1] });
}

type Obj = Record<string, unknown>;
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

/** OpenAI Chat Completions: system + user message with image_url data URLs, JSON mode. */
export class OpenAiClient implements AiTextClient {
  constructor(private readonly fetchFn: FetchFn) {}

  async generate(req: AiRequest): Promise<string> {
    const out = (await post(this.fetchFn, "https://api.openai.com/v1/chat/completions", { authorization: `Bearer ${req.apiKey}` }, {
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
    })) as Obj;
    const content = (arr(out.choices)[0]?.message as Obj | undefined)?.content;
    if (typeof content !== "string" || !content.trim()) throw AiErrors.badOutput();
    return content;
  }
}

/** Google Gemini generateContent: systemInstruction + inline image parts, JSON response MIME type. */
export class GeminiClient implements AiTextClient {
  constructor(private readonly fetchFn: FetchFn) {}

  async generate(req: AiRequest): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
    const out = (await post(this.fetchFn, url, { "x-goog-api-key": req.apiKey }, {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: "user", parts: [...req.images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } })), { text: req.text }] }],
      generationConfig: { maxOutputTokens: req.maxTokens, ...(req.json ? { responseMimeType: "application/json" } : {}) },
    })) as Obj;
    const parts = arr((arr(out.candidates)[0]?.content as Obj | undefined)?.parts);
    const text = parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
    if (!text.trim()) throw AiErrors.badOutput();
    return text;
  }
}

/** Anthropic Messages API: system prompt + base64 image blocks (no JSON mode; the prompt asks for JSON only). */
export class AnthropicClient implements AiTextClient {
  constructor(private readonly fetchFn: FetchFn) {}

  async generate(req: AiRequest): Promise<string> {
    const out = (await post(this.fetchFn, "https://api.anthropic.com/v1/messages", { "x-api-key": req.apiKey, "anthropic-version": "2023-06-01" }, {
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
    })) as Obj;
    const text = arr(out.content).filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("");
    if (!text.trim()) throw AiErrors.badOutput();
    return text;
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
