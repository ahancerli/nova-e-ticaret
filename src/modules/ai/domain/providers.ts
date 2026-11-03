/**
 * AI providers and the product fields they can fill — pure constants, safe to import from client components.
 * Adding a provider = an entry here + a client in infrastructure/ai-clients.ts + a system prompt in
 * prompts/system-prompts.ts + the value in the ai_integration.provider CHECK (db/schema.sql).
 */
export const AI_PROVIDERS = {
  openai: {
    label: "OpenAI",
    tagline: "ChatGPT modelleri",
    defaultModel: "gpt-4.1-mini",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o"],
    keyPlaceholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  gemini: {
    label: "Google Gemini",
    tagline: "Google AI Studio",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    keyPlaceholder: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  anthropic: {
    label: "Claude",
    tagline: "Anthropic",
    defaultModel: "claude-sonnet-5-5",
    models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"],
    keyPlaceholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
} as const;
export type AiProvider = keyof typeof AI_PROVIDERS;
export const AI_PROVIDER_KEYS = Object.keys(AI_PROVIDERS) as AiProvider[];

/**
 * Product fields "AI ile ürün ekle" can fill. `images` is not generated: the photos given to the AI are added
 * to the product gallery (none of the providers' text models draws product photos).
 */
export const AI_PRODUCT_FIELDS = {
  name: { label: "Ürün adı", hint: "Görsel ve açıklamadan kısa, aranabilir bir ad" },
  shortDescription: { label: "Kısa açıklama", hint: "Ürün kartında görünen 1–2 cümle" },
  description: { label: "Açıklama", hint: "Ürün sayfasındaki ayrıntılı metin" },
  seo: { label: "SEO başlığı ve açıklaması", hint: "Arama sonuçlarında görünen metin" },
  images: { label: "Görseller", hint: "Yüklediğiniz görseller ürün galerisine eklenir" },
} as const;
export type AiProductField = keyof typeof AI_PRODUCT_FIELDS;
export const AI_PRODUCT_FIELD_KEYS = Object.keys(AI_PRODUCT_FIELDS) as AiProductField[];
/** Fields the model writes (everything except the gallery). */
export type AiTextField = Exclude<AiProductField, "images">;
export const AI_DEFAULT_FIELDS: AiProductField[] = ["name", "shortDescription", "description", "images"];

export const AI_MAX_IMAGES = 2;
/** Image types all three providers accept (AVIF is not one of them). */
export const AI_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const AI_PROMPT_MIN = 10;
export const AI_PROMPT_MAX = 1500;

/** Panel view of the configured integration. The key itself never leaves the server. */
export interface AiIntegrationView {
  provider: AiProvider;
  providerLabel: string;
  model: string;
  /** Last characters of the key, e.g. "…f3Qa". */
  keyHint: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface AiIntegrationInput {
  provider: AiProvider;
  model: string;
  /** Required when there is no integration yet or the provider changes; omitted = keep the stored key. */
  apiKey?: string;
  /** `updatedAt` as loaded; null when the form was opened with no integration. */
  expectedUpdatedAt: string | null;
}

export interface ProductDraft {
  name?: string;
  shortDescription?: string;
  descriptionHtml?: string;
  seo?: { metaTitle: string; metaDescription: string };
}

export interface GenerateProductInput {
  fields: AiProductField[];
  prompt: string;
  mediaIds: string[];
}

export interface GenerateProductResult {
  draft: ProductDraft;
  provider: AiProvider;
  providerLabel: string;
  model: string;
}

export const keyHintOf = (apiKey: string) => `…${apiKey.trim().slice(-4)}`;
