import { ValidationError } from "@/core";
import { slugify } from "@/lib/slug";

/**
 * Admin forms accept free text for slugs; this turns it into the stored form ([a-z0-9-], Turkish
 * characters transliterated: "Ev & Yaşam" → "ev-yasam") or rejects it with a field error.
 */
export function normalizeSlug(raw: string): string {
  const s = slugify(raw.trim());
  if (s.length < 2) throw ValidationError.field("slug", "Geçerli bir slug girin.", "invalid_slug");
  return s;
}
