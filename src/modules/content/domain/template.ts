import { escapeHtml } from "@/core/security/sanitize-html";

/** {{name}} placeholders: lowercase segments separated by dots, e.g. {{firma.unvan}}. */
const PLACEHOLDER = /\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}/g;

export function placeholdersIn(html: string): string[] {
  return [...new Set([...html.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
}

export interface RenderResult {
  html: string;
  /** Known placeholders whose value is empty (e.g. MERSİS not entered yet). */
  missing: string[];
  /** Placeholders that do not exist (typos) — left visible in the text. */
  unknown: string[];
}

/**
 * Fills placeholders in (already sanitized) HTML. Values are HTML-escaped — a company name can never inject
 * markup — and line breaks of multi-line values (addresses) become <br>. `mark` lets the admin preview
 * highlight empty values.
 */
export function renderTemplate(html: string, vars: Record<string, string>, mark?: (name: string) => string): RenderResult {
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const out = html.replace(PLACEHOLDER, (whole, name: string) => {
    if (!Object.hasOwn(vars, name)) {
      unknown.add(name);
      return escapeHtml(whole);
    }
    const value = vars[name]!.trim();
    if (!value) {
      missing.add(name);
      return mark ? mark(name) : "";
    }
    return escapeHtml(value).replace(/\r?\n/g, "<br>");
  });
  return { html: out, missing: [...missing], unknown: [...unknown] };
}
