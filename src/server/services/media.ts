import "server-only";
import { getDb, getEnv } from "../db";
import { toHex } from "../crypto";
import { ApiError } from "../http";
import { newId } from "@/lib/ids";

/**
 * Uploaded media: bytes live in R2 (binding ASSETS_BUCKET), the DB only stores the object name
 * (media_assets.storage_key, e.g. "categories/9f…c2.webp") and its public path ("/assets/categories/…").
 * Objects are served by src/app/assets/[...path]/route.ts.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MEDIA_FOLDERS = ["categories", "brands", "products"] as const;
export type MediaFolder = (typeof MEDIA_FOLDERS)[number];

const ASSET_PREFIX = "/assets/";

// SVG is deliberately not accepted for uploads: it can carry script and is served from our own origin.
const SIGNATURES: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: "image/png", ext: "png", test: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v) },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
  { mime: "image/avif", ext: "avif", test: (b) => ascii(b, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(b, 8, 12)) },
];

function ascii(b: Uint8Array, from: number, to: number) {
  return String.fromCharCode(...b.subarray(from, to));
}

/** Detects the real image type from magic bytes (the browser-supplied type is not trusted). */
export function sniffImage(bytes: Uint8Array): { mime: string; ext: string } | null {
  const hit = SIGNATURES.find((s) => s.test(bytes));
  return hit ? { mime: hit.mime, ext: hit.ext } : null;
}

/** Best-effort pixel size for PNG / JPEG / WebP (stored in media_assets.width/height when known). */
export function imageSize(bytes: Uint8Array, mime: string): { width: number; height: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (mime === "image/png") return { width: dv.getUint32(16), height: dv.getUint32(20) };
    if (mime === "image/webp") {
      const kind = ascii(bytes, 12, 16);
      if (kind === "VP8X") return { width: 1 + (dv.getUint16(24, true) | (bytes[26]! << 16)), height: 1 + (dv.getUint16(27, true) | (bytes[29]! << 16)) };
      if (kind === "VP8L") { const v = dv.getUint32(21, true); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
      if (kind === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    }
    if (mime === "image/jpeg") {
      for (let i = 2; i + 9 < bytes.length; ) {
        if (bytes[i] !== 0xff) return null;
        const marker = bytes[i + 1]!;
        const len = dv.getUint16(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
        i += 2 + len;
      }
    }
  } catch {
    /* truncated header → unknown size */
  }
  return null;
}

/** Human readable alt text from the original file name: "yaz-koleksiyonu_01.JPG" → "yaz koleksiyonu 01". */
function altFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export async function uploadImage(input: { bytes: Uint8Array; fileName: string; folder: MediaFolder; uploadedBy: string | null }) {
  const { bytes, folder } = input;
  if (bytes.byteLength === 0) throw new ApiError(422, "empty_file", "Dosya boş.", { file: ["Dosya boş."] });
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ApiError(413, "file_too_large", "Görsel en fazla 5 MB olabilir.", { file: ["Görsel en fazla 5 MB olabilir."] });
  const kind = sniffImage(bytes);
  if (!kind) throw new ApiError(415, "unsupported_image", "Sadece JPG, PNG, WebP veya AVIF yükleyebilirsiniz.", { file: ["Desteklenmeyen dosya türü."] });

  const env = await getEnv();
  if (!env.ASSETS_BUCKET) throw new ApiError(500, "storage_unavailable", "Dosya deposu yapılandırılmamış.");
  const db = await getDb();

  const id = newId();
  const storageKey = `${folder}/${id}.${kind.ext}`;
  const publicUrl = `${ASSET_PREFIX}${storageKey}`;
  const size = imageSize(bytes, kind.mime);
  const sha = toHex(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));

  await env.ASSETS_BUCKET.put(storageKey, bytes, {
    httpMetadata: { contentType: kind.mime, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { mediaId: id },
  });
  try {
    await db
      .prepare(`INSERT INTO media_assets (id, storage_key, public_url, mime_type, byte_size, width, height, alt_text, sha256, rights_note, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin upload', ?)`)
      .bind(id, storageKey, publicUrl, kind.mime, bytes.byteLength, size?.width || null, size?.height || null,
        altFromFileName(input.fileName), sha, input.uploadedBy)
      .run();
  } catch (err) {
    await env.ASSETS_BUCKET.delete(storageKey).catch(() => undefined);
    throw err;
  }
  return { id, url: publicUrl, storageKey, mime: kind.mime, bytes: bytes.byteLength, width: size?.width ?? null, height: size?.height ?? null };
}

/**
 * Deletes an uploaded asset once nothing points at it any more. Seed/demo assets (not under an upload
 * folder) are never touched. Any FK RESTRICT (product media, slides, …) keeps the row — that is the point.
 */
export async function releaseMedia(mediaId: string | null | undefined) {
  if (!mediaId) return;
  const db = await getDb();
  const env = await getEnv();
  const row = await db.prepare("SELECT storage_key FROM media_assets WHERE id = ?").bind(mediaId).first<{ storage_key: string }>();
  if (!row || !MEDIA_FOLDERS.some((f) => row.storage_key.startsWith(`${f}/`))) return;
  const used = await db
    .prepare(`SELECT 1 FROM categories WHERE image_media_id = ?1 OR menu_media_id = ?1
              UNION ALL SELECT 1 FROM brands WHERE logo_media_id = ?1 OR banner_media_id = ?1
              UNION ALL SELECT 1 FROM product_media WHERE media_id = ?1
              LIMIT 1`)
    .bind(mediaId)
    .first();
  if (used) return;
  try {
    await db.prepare("DELETE FROM media_assets WHERE id = ?").bind(mediaId).run();
  } catch {
    return; // still referenced elsewhere (FK RESTRICT) → keep both row and object
  }
  await env.ASSETS_BUCKET?.delete(row.storage_key).catch(() => undefined);
}

/** Reads an uploaded object for the public /assets route. Key format is validated by the caller. */
export async function readAsset(key: string) {
  const env = await getEnv();
  return env.ASSETS_BUCKET ? env.ASSETS_BUCKET.get(key) : null;
}
