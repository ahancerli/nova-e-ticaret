import { hmacHex, safeEqual } from "@/core";

/**
 * Meta signs every webhook POST: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(app secret, raw body)>` (docs: Webhooks ›
 * Validating payloads, checked 2026-11-16). Instagram Login apps carry their own app secret next to the Meta app's, so
 * the payload is accepted when ANY configured secret matches. No secret configured → nothing is accepted.
 */
export async function metaSignatureValid(rawBody: string, header: string | null, secrets: string[]): Promise<boolean> {
  const given = header?.trim().toLowerCase() ?? "";
  if (!given.startsWith("sha256=") || !secrets.length) return false;
  for (const secret of secrets) {
    if (secret && safeEqual(given, `sha256=${await hmacHex(secret, rawBody)}`)) return true;
  }
  return false;
}
