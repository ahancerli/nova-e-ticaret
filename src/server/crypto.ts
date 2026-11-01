import "server-only";

const enc = new TextEncoder();

export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(input)));
}

export async function hmacSha256(key: string, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

export async function hmacHex(key: string, data: string): Promise<string> {
  return toHex(await hmacSha256(key, data));
}

/** URL-safe random token (default 32 bytes). Only its HMAC is stored in the DB. */
export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64(b).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- Envelope encryption for integration_secrets (AES-256-GCM, master key from env) ---
async function masterKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromBase64(b64), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(masterKeyB64: string, plaintext: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, await masterKey(masterKeyB64), enc.encode(plaintext)),
  );
  const tagStart = sealed.length - 16;
  return {
    ciphertext: toBase64(sealed.slice(0, tagStart)),
    authTag: toBase64(sealed.slice(tagStart)),
    nonce: toBase64(nonce),
  };
}

export async function decryptSecret(masterKeyB64: string, s: { ciphertext: string; authTag: string; nonce: string }) {
  const ct = fromBase64(s.ciphertext);
  const tag = fromBase64(s.authTag);
  const joined = new Uint8Array(ct.length + tag.length);
  joined.set(ct);
  joined.set(tag, ct.length);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(s.nonce), tagLength: 128 }, await masterKey(masterKeyB64), joined);
  return new TextDecoder().decode(plain);
}
