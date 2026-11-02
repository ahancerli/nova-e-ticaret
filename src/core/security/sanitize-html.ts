/**
 * HTML output safety (pure, no I/O). React already escapes JSX text; these are for the few places
 * that emit HTML strings (admin-authored rich text rendered with dangerouslySetInnerHTML).
 */

/** Escapes text for HTML contexts (reviews, names) — React already escapes JSX text. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Allowlist HTML sanitizer for admin-authored rich text (product descriptions, content pages).
 * A small tokenizer (not a regex replace): text is escaped, only allowlisted tags are re-emitted without
 * attributes (except a safe href on <a>), dropped blocks lose their content, and the output is balanced.
 * For untrusted user content (reviews) never render HTML at all — use plain text.
 */
const ALLOWED_TAGS = new Set(["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h2", "h3", "h4", "blockquote", "a", "table", "thead", "tbody", "tr", "th", "td"]);
const VOID_TAGS = new Set(["br"]);
const DROP_CONTENT_TAGS = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "textarea", "title", "xmp", "noembed", "noframes", "plaintext", "svg", "math", "select"]);
const ENTITY = /^&(#[0-9]{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});/i;
// https:// or a same-site path; "//host" and "/\\host" are protocol-relative in browsers and rejected.
const SAFE_HREF = /^(https:\/\/[^\s"'<>`\\]+|\/(?![/\\])[^\s"'<>`\\]*)$/i;

/**
 * Attribute values are entity-decoded by the browser, so "/&#47;evil.com" would become "//evil.com".
 * Only "&amp;" is decoded here; any other character reference makes the link unsafe.
 */
function safeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (/&(?!amp;)[#a-z]/i.test(trimmed)) return null;
  const href = trimmed.replace(/&amp;/gi, "&");
  return SAFE_HREF.test(href) ? href : null;
}

/** Reads one tag starting at `html[i] === "<"`; returns null when it is not a tag (a literal "<"). */
function readTag(html: string, i: number): { name: string; closing: boolean; attrs: Map<string, string>; end: number } | null {
  const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(i, i + 64));
  if (!m) return null;
  const attrs = new Map<string, string>();
  let j = i + m[0].length;
  while (j < html.length) {
    const c = html[j]!;
    if (c === ">") return { name: m[2]!.toLowerCase(), closing: m[1] === "/", attrs, end: j + 1 };
    if (/[\s/]/.test(c)) { j++; continue; }
    const an = /^[^\s"'>/=]+/.exec(html.slice(j));
    if (!an) { j++; continue; }
    const attrName = an[0].toLowerCase();
    j += an[0].length;
    while (/\s/.test(html[j] ?? "")) j++;
    let value = "";
    if (html[j] === "=") {
      j++;
      while (/\s/.test(html[j] ?? "")) j++;
      const q = html[j];
      if (q === '"' || q === "'") {
        const close = html.indexOf(q, j + 1);
        if (close === -1) return { name: m[2]!.toLowerCase(), closing: m[1] === "/", attrs, end: html.length };
        value = html.slice(j + 1, close);
        j = close + 1;
      } else {
        const uv = /^[^\s>]*/.exec(html.slice(j))![0];
        value = uv;
        j += uv.length;
      }
    }
    if (!attrs.has(attrName)) attrs.set(attrName, value);
  }
  // Unterminated tag at end of input: drop it.
  return { name: m[2]!.toLowerCase(), closing: m[1] === "/", attrs, end: html.length };
}

function escapeText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "&") {
      const ent = ENTITY.exec(text.slice(i, i + 40));
      if (ent) { out += ent[0]; i += ent[0].length - 1; } else out += "&amp;";
    } else if (c === "<") out += "&lt;";
    else if (c === ">") out += "&gt;";
    else if (c === '"') out += "&quot;";
    else out += c;
  }
  return out;
}

export function sanitizeRichHtml(html: string): string {
  const out: string[] = [];
  const open: string[] = [];
  let text = "";
  let i = 0;
  const flush = () => { if (text) { out.push(escapeText(text)); text = ""; } };
  while (i < html.length) {
    const c = html[i]!;
    if (c !== "<") { text += c; i++; continue; }
    // Comments, doctype, CDATA and processing instructions are dropped.
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const end = html.indexOf(">", i);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const tag = readTag(html, i);
    if (!tag) { text += c; i++; continue; }
    flush();
    i = tag.end;
    if (!tag.closing && DROP_CONTENT_TAGS.has(tag.name)) {
      const closeRe = new RegExp(`</${tag.name}[\\s/>]`, "i");
      const rest = closeRe.exec(html.slice(i));
      if (!rest) break;
      const after = html.indexOf(">", i + rest.index);
      i = after === -1 ? html.length : after + 1;
      continue;
    }
    if (!ALLOWED_TAGS.has(tag.name)) continue;
    if (tag.closing) {
      const at = open.lastIndexOf(tag.name);
      if (at === -1) continue;
      while (open.length > at) out.push(`</${open.pop()}>`);
      continue;
    }
    if (VOID_TAGS.has(tag.name)) { out.push(`<${tag.name}>`); continue; }
    if (tag.name === "a") {
      const href = safeHref(tag.attrs.get("href") ?? "");
      out.push(href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">` : "<a>");
    } else {
      out.push(`<${tag.name}>`);
    }
    open.push(tag.name);
  }
  flush();
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join("");
}
