import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import type { ObjectStorage, StoredObject } from "../application/ports";

interface ObjectMeta {
  contentType: string;
  etag: string;
  metadata: Record<string, string>;
}

// keys we generate: "<folder>/<uuid>.<ext>" — no "..", no absolute paths, no hidden files
const KEY = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/;

/**
 * Adapter: a directory on disk (the Docker volume, MEDIA_DIR) → ObjectStorage port.
 * Each object is `<root>/<key>` plus a `<key>.meta.json` sidecar (content type, etag, custom metadata).
 * Files are written to a temp name and renamed, so a reader never sees half an image.
 */
export class FsObjectStorage implements ObjectStorage {
  readonly available = true;
  private readonly root: string;

  constructor(root: string) {
    // turbopackIgnore: runtime paths (the media volume), not files to trace into the standalone output
    this.root = resolve(/* turbopackIgnore: true */ root);
  }

  async put(key: string, bytes: Uint8Array, contentType: string, metadata: Record<string, string>): Promise<void> {
    const file = this.pathOf(key);
    if (!file) throw new Error(`invalid storage key: ${key}`);
    await mkdir(dirname(file), { recursive: true });
    const meta: ObjectMeta = { contentType, etag: createHash("md5").update(bytes).digest("hex"), metadata };
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(/* turbopackIgnore: true */ tmp, bytes);
    await rename(/* turbopackIgnore: true */ tmp, file);
    await writeFile(/* turbopackIgnore: true */ `${file}.meta.json`, JSON.stringify(meta));
  }

  async get(key: string): Promise<StoredObject | null> {
    const file = this.pathOf(key);
    if (!file) return null;
    let meta: ObjectMeta;
    try {
      meta = JSON.parse(await readFile(/* turbopackIgnore: true */ `${file}.meta.json`, "utf8")) as ObjectMeta;
      await stat(/* turbopackIgnore: true */ file);
    } catch {
      return null;
    }
    return {
      body: Readable.toWeb(createReadStream(/* turbopackIgnore: true */ file)) as unknown as ReadableStream,
      httpEtag: `"${meta.etag}"`,
      writeHttpMetadata: (headers) => headers.set("content-type", meta.contentType),
    };
  }

  async delete(key: string): Promise<void> {
    const file = this.pathOf(key);
    if (!file) return;
    await rm(/* turbopackIgnore: true */ file, { force: true });
    await rm(/* turbopackIgnore: true */ `${file}.meta.json`, { force: true });
  }

  private pathOf(key: string): string | null {
    if (!KEY.test(key) || key.endsWith(".meta.json")) return null;
    const file = resolve(/* turbopackIgnore: true */ this.root, key);
    return file.startsWith(this.root + sep) ? file : null;
  }
}

/** Used when MEDIA_DIR is not configured: uploads answer "storage not available" instead of failing later. */
export const unavailableObjectStorage: ObjectStorage = {
  available: false,
  put: () => Promise.reject(new Error("MEDIA_DIR is not configured")),
  get: () => Promise.reject(new Error("MEDIA_DIR is not configured")),
  delete: () => Promise.reject(new Error("MEDIA_DIR is not configured")),
};
