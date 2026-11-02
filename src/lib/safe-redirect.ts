/**
 * Open-redirect guard for `?next=` style parameters: only same-site paths are allowed.
 * Browsers treat "\" like "/" and ignore tabs/newlines in URLs, so "/\evil.com" or "/\t/evil.com"
 * would become "//evil.com" (another host); those are rejected along with absolute URLs.
 */
export function safeInternalPath(next: string | null | undefined, fallback: string): string {
  if (!next || next.length > 2048) return fallback;
  if (!next.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(next) || next.startsWith("//")) return fallback;
  try {
    const base = "https://nova.invalid";
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
