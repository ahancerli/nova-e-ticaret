import type { ObjectStorage, StoredObject } from "../application/ports";

/** Adapter: R2 bucket binding → ObjectStorage port. A missing binding is reported as `available = false`. */
export class R2ObjectStorage implements ObjectStorage {
  constructor(private readonly bucket: R2Bucket | undefined) {}

  get available(): boolean {
    return Boolean(this.bucket);
  }

  async put(key: string, bytes: Uint8Array, contentType: string, metadata: Record<string, string>): Promise<void> {
    await this.required().put(key, bytes, {
      httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: metadata,
    });
  }

  async get(key: string): Promise<StoredObject | null> {
    return this.required().get(key);
  }

  async delete(key: string): Promise<void> {
    await this.required().delete(key);
  }

  private required(): R2Bucket {
    if (!this.bucket) throw new Error("ASSETS_BUCKET binding is not configured");
    return this.bucket;
  }
}
