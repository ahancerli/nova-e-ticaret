import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a script nonce (no 'unsafe-inline' for scripts).
 * Next.js reads the nonce from the request's CSP header and stamps it on its own scripts, so every
 * page must render dynamically (the root layout awaits `connection()`).
 *
 * Styles keep 'unsafe-inline': React `style` attributes, Sonner and AG Grid inject inline styles,
 * and style injection cannot execute script.
 * API routes and static files get a locked-down policy from next.config.ts instead.
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV === "development";

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(isDev ? ["ws:", "wss:"] : [])],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const csp = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .concat(isDev ? [] : ["upgrade-insecure-requests"])
    .join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: API routes, build output, uploaded assets and public files are excluded.
      source: "/((?!api|_next/static|_next/image|assets|demo|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
