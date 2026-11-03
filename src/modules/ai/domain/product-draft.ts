import { sanitizeRichHtml } from "@/core";
import type { AiTextField, ProductDraft } from "./providers";

// Same limits as the product form / catalog input schema.
const LIMITS = { name: 160, shortDescription: 300, metaTitle: 120, metaDescription: 320, descriptionHtml: 20_000 };

const clip = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};

/** First JSON object in a model answer (tolerates ```json fences and text around it). */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Model answer → product draft, keeping only the requested fields, clipped to the form limits; the description
 * goes through the same HTML allowlist as everything an admin writes. Null when nothing usable came back.
 */
export function parseProductDraft(text: string, fields: AiTextField[]): ProductDraft | null {
  const o = extractJsonObject(text);
  if (!o) return null;
  const want = new Set(fields);
  const draft: ProductDraft = {};
  if (want.has("name")) draft.name = clip(o.name, LIMITS.name);
  if (want.has("shortDescription")) draft.shortDescription = clip(o.shortDescription, LIMITS.shortDescription);
  if (want.has("description") && typeof o.descriptionHtml === "string") {
    const html = sanitizeRichHtml(o.descriptionHtml).trim();
    if (html && html.length <= LIMITS.descriptionHtml) draft.descriptionHtml = html;
  }
  if (want.has("seo")) {
    const metaTitle = clip(o.metaTitle, LIMITS.metaTitle);
    const metaDescription = clip(o.metaDescription, LIMITS.metaDescription);
    if (metaTitle || metaDescription) draft.seo = { metaTitle: metaTitle ?? "", metaDescription: metaDescription ?? "" };
  }
  for (const k of Object.keys(draft) as (keyof ProductDraft)[]) if (draft[k] === undefined) delete draft[k];
  if (draft.name && draft.name.length < 2) delete draft.name;
  return Object.keys(draft).length ? draft : null;
}
