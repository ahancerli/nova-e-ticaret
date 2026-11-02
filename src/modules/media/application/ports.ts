import type { Statement } from "@/core";

export interface NewMediaAsset {
  id: string;
  storageKey: string;
  publicUrl: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  altText: string;
  sha256: string;
  uploadedBy: string | null;
}

export interface MediaRepository {
  /** Mime type of an asset, or null when it does not exist. */
  mimeOf(id: string): Promise<string | null>;
  storageKeyOf(id: string): Promise<string | null>;
  /** True while any category, brand or product still points at the asset. */
  isReferenced(id: string): Promise<boolean>;
  insertStatement(asset: NewMediaAsset): Statement;
  /** Deletes the row; false when an FK RESTRICT elsewhere still holds it. */
  delete(id: string): Promise<boolean>;
}

export interface StoredObject {
  body: ReadableStream;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

/** Object storage port (R2 in production, local R2 in dev, in-memory in tests). */
export interface ObjectStorage {
  readonly available: boolean;
  put(key: string, bytes: Uint8Array, contentType: string, metadata: Record<string, string>): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}
