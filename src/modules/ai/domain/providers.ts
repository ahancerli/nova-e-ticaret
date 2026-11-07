/**
 * AI providers and the product fields they can fill — pure constants, safe to import from client components.
 * Adding a provider = an entry here + a client in infrastructure/ai-clients.ts + a system prompt in
 * prompts/system-prompts.ts + the value in the ai_integration / ai_models provider CHECKs and its ai_models rows
 * (db/schema.sql). Models live in the ai_models table, not here.
 */
export const AI_PROVIDERS = {
  openai: {
    label: "OpenAI",
    tagline: "ChatGPT modelleri",
    keyPlaceholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  gemini: {
    label: "Google Gemini",
    tagline: "Google AI Studio",
    keyPlaceholder: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  anthropic: {
    label: "Claude",
    tagline: "Anthropic",
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

export type AiModelStatus = "active" | "deprecated" | "retired";

/** A row of the ai_models catalog (the panel's model select). */
export interface AiModelOption {
  provider: AiProvider;
  id: string;
  label: string;
  note: string | null;
  status: AiModelStatus;
  /** YYYY-MM-DD shutdown date announced by the provider. */
  retiresAt: string | null;
}

/** Provider → selectable models (retired ones left out), default first. */
export type AiModelCatalog = Record<AiProvider, AiModelOption[]>;

/** Result of "Bağlantıyı test et": the free model lookup, then a tiny generation. */
export interface AiHealthReport {
  provider: string;
  model: string;
  /** Name the provider reports for the model, when it reports one. */
  displayName: string | null;
  /** Shutdown announced by the provider or in our catalog → the panel suggests another model. */
  deprecated: boolean;
  retiresAt: string | null;
  modelCheckMs: number;
  generationMs: number;
}

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
