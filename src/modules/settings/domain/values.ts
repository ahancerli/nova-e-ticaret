import { z } from "zod";
import "@/modules/shared/schemas"; // Turkish Zod messages
import { MAX_LIST_ITEMS, SETTINGS_BY_KEY, type SettingDef } from "./registry";

/** Stored JSON shapes per type. `null` = not set (the row is removed). */
export type LinkValue = { text: string; href: string | null };
export type SettingValue = string | boolean | string[] | LinkValue | null;

const httpUrl = (max: number) => z.string().trim().max(max).refine((v) => {
  try {
    const u = new URL(v);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}, "Geçerli bir adres girin (https://…).");

/** Internal path ("/kampanyalar") or absolute https URL — same rule as navigation_items.href. */
const linkHref = z.string().trim().max(300).refine((v) => (v.startsWith("/") && !v.startsWith("//")) || v.startsWith("https://"), "Bağlantı / ile ya da https:// ile başlamalı.");

function schemaFor(def: SettingDef): z.ZodType<SettingValue> {
  const max = def.max ?? 500;
  const text = z.string().trim().max(max);
  switch (def.type) {
    case "text":
    case "textarea":
      return text;
    case "email":
      return z.string().trim().max(max).pipe(z.email("Geçerli bir e-posta girin."));
    case "phone":
      return z.string().trim().max(max).regex(/^\+?[0-9 ()-]{7,}$/, "Geçerli bir telefon girin.");
    case "url":
      return httpUrl(max);
    case "digits": {
      const lengths = def.lengths ?? [];
      return z.string().trim().regex(/^\d+$/, "Yalnız rakam girin.")
        .refine((v) => lengths.length === 0 || lengths.includes(v.length), `${lengths.join(" veya ")} haneli olmalı.`);
    }
    case "image":
      return z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "Geçersiz görsel.");
    case "boolean":
      return z.boolean();
    case "color":
      return z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, "Renk #RRGGBB biçiminde olmalı.");
    case "list":
      return z.array(z.string().trim().min(1).max(max)).max(MAX_LIST_ITEMS, `En fazla ${MAX_LIST_ITEMS} öğe.`);
    case "link":
      return z.object({ text: z.string().trim().min(1).max(max), href: linkHref.nullable() }).strict();
  }
}

/** Empty strings, empty lists and links without text mean "not set". */
export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.every((x) => typeof x === "string" && x.trim() === "");
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text ?? "").trim() === "";
  return false;
}

export type ValidationResult = { values: Record<string, SettingValue>; fieldErrors: Record<string, string[]> };

/**
 * Validates a partial update: only keys of the registry, each against its own type. Required settings cannot be
 * cleared. Returns normalised values (trimmed, empty → null) or per-key error messages for the form.
 */
export function validateSettings(input: Record<string, unknown>, allowedKeys: readonly string[]): ValidationResult {
  const values: Record<string, SettingValue> = {};
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(input)) {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def || !allowedKeys.includes(key)) {
      fieldErrors[key] = ["Bilinmeyen ayar."];
      continue;
    }
    if (isEmptyValue(raw)) {
      if (def.required) fieldErrors[key] = ["Bu alan zorunlu."];
      else values[key] = null;
      continue;
    }
    const cleaned = def.type === "list" && Array.isArray(raw) ? raw.filter((x) => !isEmptyValue(x)) : raw;
    const r = schemaFor(def).safeParse(cleaned);
    if (r.success) values[key] = r.data;
    else fieldErrors[key] = r.error.issues.map((i) => i.message);
  }
  return { values, fieldErrors };
}
