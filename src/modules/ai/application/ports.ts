import type { Statement } from "@/core";
import type { AiProvider } from "../domain/providers";

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

/** One provider's HTTP API (Strategy). Throws AiErrors (key rejected, rate limited, provider failed). */
export interface AiTextClient {
  generate(req: AiRequest): Promise<string>;
}

export type AiClientFactory = (provider: AiProvider) => AiTextClient;

/** Reads an uploaded image (implemented by the media module's MediaLibrary). */
export interface ImageReader {
  readImage(mediaId: string): Promise<{ mime: string; bytes: Uint8Array } | null>;
}
