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

/** Inclusive byte positions; `end` omitted = to the end of the object. */
export interface ByteRange {
  start: number;
  end?: number;
}

export interface StoredObject {
  body: ReadableStream;
  /** Total size of the object in bytes (not of the returned part). */
  size?: number;
  /** Set when a part was returned: the inclusive positions actually served. */
  range?: { start: number; end: number };
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
}

/** Object storage port (a directory on disk — MEDIA_DIR — on the server, in-memory in tests). */
export interface ObjectStorage {
  readonly available: boolean;
  put(key: string, bytes: Uint8Array, contentType: string, metadata: Record<string, string>): Promise<void>;
  /** With `range`, the body holds only that part (clamped to the object); a start past the end yields an empty part. */
  get(key: string, range?: ByteRange): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}
