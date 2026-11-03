import { InternalError, PayloadTooLargeError, UnitOfWork, UnsupportedMediaTypeError, ValidationError, type Database, type IdGenerator, type Logger } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { Actor } from "@/modules/shared/actor";
import { ASSET_PREFIX, MAX_IMAGE_BYTES, STORAGE_KEY_PATTERN, altFromFileName, imageSize, isUploadedKey, sniffImage, type MediaFolder } from "../domain/image";
import type { MediaRepository, ObjectStorage, StoredObject } from "./ports";

export interface UploadedImage {
  id: string;
  url: string;
  storageKey: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

/** Command: stores an uploaded image (object first, then row + audit atomically; object removed if the row fails). */
export class UploadImage {
  constructor(
    private readonly db: Database,
    private readonly media: MediaRepository,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditLog,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: { bytes: Uint8Array; fileName: string; folder: MediaFolder }, actor: Actor): Promise<UploadedImage> {
    const { bytes, folder } = input;
    if (bytes.byteLength === 0) throw ValidationError.field("file", "Dosya boş.", "empty_file");
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeError("file_too_large", "Görsel en fazla 5 MB olabilir.", { fieldErrors: { file: ["Görsel en fazla 5 MB olabilir."] } });
    }
    const kind = sniffImage(bytes);
    if (!kind) {
      throw new UnsupportedMediaTypeError("unsupported_image", "Sadece JPG, PNG, WebP veya AVIF yükleyebilirsiniz.", { fieldErrors: { file: ["Desteklenmeyen dosya türü."] } });
    }
    if (!this.storage.available) throw new InternalError("storage_unavailable", "Dosya deposu yapılandırılmamış.");

    const id = this.ids.newId();
    const storageKey = `${folder}/${id}.${kind.ext}`;
    const publicUrl = `${ASSET_PREFIX}${storageKey}`;
    const size = imageSize(bytes, kind.mime);
    const sha256 = toHex(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));

    await this.storage.put(storageKey, bytes, kind.mime, { mediaId: id });
    try {
      await new UnitOfWork(this.db)
        .add(this.media.insertStatement({
          id, storageKey, publicUrl, mime: kind.mime, bytes: bytes.byteLength,
          width: size?.width || null, height: size?.height || null,
          altText: altFromFileName(input.fileName), sha256, uploadedBy: actor.userId,
        }))
        .add(this.audit.recordStatement({ actor, action: "media.upload", entityType: "media", entityId: id, diff: { storageKey, bytes: bytes.byteLength, mime: kind.mime } }))
        .commit();
    } catch (err) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw err;
    }
    return { id, url: publicUrl, storageKey, mime: kind.mime, bytes: bytes.byteLength, width: size?.width ?? null, height: size?.height ?? null };
  }
}

/** Port used by other modules: "is this id an image?" and "drop it if nothing uses it any more". */
export interface MediaLibrary {
  assertImage(mediaId: string, field: string): Promise<void>;
  /** Deletes an uploaded asset (row + object) once nothing references it. Seed/demo assets are never touched. */
  release(mediaId: string | null | undefined): Promise<void>;
  /** Bytes of an uploaded image (e.g. to send to an AI provider); null when missing or not stored. */
  readImage(mediaId: string): Promise<{ mime: string; bytes: Uint8Array } | null>;
}

export class MediaLibraryService implements MediaLibrary {
  constructor(private readonly media: MediaRepository, private readonly storage: ObjectStorage, private readonly logger: Logger) {}

  async assertImage(mediaId: string, field: string): Promise<void> {
    const mime = await this.media.mimeOf(mediaId);
    if (!mime || !mime.startsWith("image/")) throw ValidationError.field(field, "Geçerli bir görsel seçin.", "invalid_media");
  }

  async release(mediaId: string | null | undefined): Promise<void> {
    if (!mediaId) return;
    const key = await this.media.storageKeyOf(mediaId);
    if (!key || !isUploadedKey(key)) return;
    if (await this.media.isReferenced(mediaId)) return;
    if (!(await this.media.delete(mediaId))) return;
    // Cleanup must never fail the user's (already committed) change; an orphan object is only logged.
    await this.storage.delete(key).catch((err: unknown) => this.logger.warn("media object delete failed", { key, error: String(err) }));
  }

  async readImage(mediaId: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
    const [key, mime] = await Promise.all([this.media.storageKeyOf(mediaId), this.media.mimeOf(mediaId)]);
    if (!key || !mime?.startsWith("image/") || !isUploadedKey(key) || !this.storage.available) return null;
    const obj = await this.storage.get(key);
    return obj ? { mime, bytes: new Uint8Array(await new Response(obj.body).arrayBuffer()) } : null;
  }
}

/** Query: an uploaded object for the public /assets route. */
export class ReadAsset {
  constructor(private readonly storage: ObjectStorage) {}

  async execute(key: string): Promise<StoredObject | null> {
    if (!STORAGE_KEY_PATTERN.test(key) || !this.storage.available) return null;
    return this.storage.get(key);
  }
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
