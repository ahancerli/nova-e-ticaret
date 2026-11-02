/**
 * Uploaded image rules (pure functions, no I/O).
 * Bytes live in object storage under "<folder>/<uuid>.<ext>"; the DB stores the key and its public path.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MEDIA_FOLDERS = ["categories", "brands", "products"] as const;
export type MediaFolder = (typeof MEDIA_FOLDERS)[number];
export const ASSET_PREFIX = "/assets/";

/** The only object keys the public /assets route serves (no traversal, no listing, no foreign keys). */
export const STORAGE_KEY_PATTERN = /^(categories|brands|products)\/[0-9a-f-]{36}\.(png|jpg|webp|avif)$/;

export const isMediaFolder = (v: string): v is MediaFolder => (MEDIA_FOLDERS as readonly string[]).includes(v);
export const isUploadedKey = (storageKey: string): boolean => MEDIA_FOLDERS.some((f) => storageKey.startsWith(`${f}/`));

export interface ImageKind {
  mime: string;
  ext: string;
}

// SVG is deliberately not accepted: it can carry script and would be served from our own origin.
const SIGNATURES: (ImageKind & { test: (b: Uint8Array) => boolean })[] = [
  { mime: "image/png", ext: "png", test: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v) },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", test: (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP" },
  { mime: "image/avif", ext: "avif", test: (b) => ascii(b, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(b, 8, 12)) },
];

function ascii(b: Uint8Array, from: number, to: number) {
  return String.fromCharCode(...b.subarray(from, to));
}

/** Detects the real image type from magic bytes (the browser-supplied type is not trusted). */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  const hit = SIGNATURES.find((s) => s.test(bytes));
  return hit ? { mime: hit.mime, ext: hit.ext } : null;
}

/** Best-effort pixel size for PNG / JPEG / WebP. */
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
export function altFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}
