import type { Statement } from "@/core";
import type { AiModelOption, AiProvider } from "../domain/providers";

export interface SealedKey {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
}

export interface StoredAiIntegration {
  provider: AiProvider;
  model: string;
  key: SealedKey;
  keyHint: string;
  updatedAt: string;
  updatedByName: string | null;
}

export interface AiIntegrationRepository {
  find(): Promise<StoredAiIntegration | null>;
  insertStatement(row: { provider: AiProvider; model: string; key: SealedKey; keyHint: string; actorId: string; now: string }): Statement;
  /** Guarded on `expectedUpdatedAt`; `key` null = keep the stored key. */
  updateStatement(row: { provider: AiProvider; model: string; key: SealedKey | null; keyHint: string | null; actorId: string; now: string }, expectedUpdatedAt: string): Statement;
  deleteStatement(expectedUpdatedAt: string): Statement;
}

/** The ai_models catalog (reference data maintained in db/schema.sql). */
export interface AiModelRepository {
  /** Non-retired models, by provider then sort order. */
  listSelectable(): Promise<AiModelOption[]>;
  find(provider: AiProvider, modelId: string): Promise<AiModelOption | null>;
}

export interface AiImage {
  mime: string;
  base64: string;
}

export interface AiRequest {
  model: string;
  apiKey: string;
  system: string;
  text: string;
  images: AiImage[];
  maxTokens: number;
  /** Ask the provider for a JSON object where it supports a JSON mode. */
  json: boolean;
}

/** What a provider's models endpoint says about one model. */
export interface AiModelInfo {
  id: string;
  displayName: string | null;
  /** Shutdown announced (Claude `lifecycle: deprecated`, OpenAI `shutdown_date`). */
  deprecated: boolean;
  retiresAt: string | null;
}

/** A function the model may call (provider independent). `parameters` = JSON Schema object (type / properties / required only). */
export interface AiToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * One entry of a tool-use conversation. `raw` on an assistant message is the provider's own content of that turn
 * (Claude thinking blocks, Gemini thought signatures): the client that produced it sends it back unchanged while the
 * same tool loop runs. Messages loaded from storage carry no `raw` and are rebuilt from `text`.
 */
export type AiChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls?: AiToolCall[]; raw?: unknown }
  | { role: "tool"; results: { id: string; name: string; output: string; isError?: boolean }[] };

export interface AiChatRequest {
  model: string;
  apiKey: string;
  system: string;
  messages: AiChatMessage[];
  tools: AiToolDef[];
  maxTokens: number;
}

/** The model's answer to one request: text for the person and / or tool calls to run before asking again. */
export interface AiChatTurn {
  text: string;
  toolCalls: AiToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  raw: unknown;
}

/** One provider's HTTP API (Strategy). Throws AiErrors (key rejected, quota, model not found, busy, …). */
export interface AiTextClient {
  generate(req: AiRequest): Promise<string>;
  /** Tool use (function calling): one model turn of a conversation. The caller runs the tools and calls again. */
  converse(req: AiChatRequest): Promise<AiChatTurn>;
  /** Health check: GET the model from the provider's models endpoint — proves key + model, costs no tokens. */
  checkModel(apiKey: string, model: string): Promise<AiModelInfo>;
}

export type AiClientFactory = (provider: AiProvider) => AiTextClient;

/** Reads an uploaded image (implemented by the media module's MediaLibrary). */
export interface ImageReader {
  readImage(mediaId: string): Promise<{ mime: string; bytes: Uint8Array } | null>;
}

/**
 * Port other modules talk to the shop's AI provider through (tool-use conversations). The key never leaves the ai
 * module; `status` lets a feature say "AI entegrasyonu gerekli" before it is used.
 */
export interface AiChat {
  status(): Promise<{ ready: boolean; provider: AiProvider | null; model: string | null }>;
  /** Throws AiErrors (`ai_not_configured` without an integration). */
  turn(input: { system: string; messages: AiChatMessage[]; tools: AiToolDef[]; maxTokens?: number }): Promise<AiChatTurn>;
}
