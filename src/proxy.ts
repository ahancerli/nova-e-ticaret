import { NextResponse, type NextRequest } from "next/server";
import { CAPTCHA_CSP } from "@/modules/captcha/domain/captcha";
import { TRACKING_CSP } from "@/modules/consent/domain/tags";

/**
 * Per-request Content-Security-Policy with a script nonce (no 'unsafe-inline' for scripts).
 * Next.js reads the nonce from the request's CSP header and stamps it on its own scripts, so every
 * page must render dynamically (the root layout awaits `connection()`).
 *
 * Styles keep 'unsafe-inline': React `style` attributes, Sonner and AG Grid inject inline styles,
 * and style injection cannot execute script.
 * API routes and static files get a locked-down policy from next.config.ts instead.
 *
 * Storefront pages also allow the beacon / iframe hosts of the tracking vendors (consent/domain/tags.ts). Their scripts
 * need no host entry: the consent tag manager inserts them from a nonced bundle, which 'strict-dynamic' trusts.
 * A tag only loads after the visitor's consent, so allowing the hosts of unused vendors changes nothing.
 * CAPTCHA widgets (Turnstile / reCAPTCHA iframes) are allowed on both sides: the storefront forms and the panel's
 * key check (Ayarlar › Bot koruması); their scripts load only while protection is on.
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV === "development";
  // The panel may show the storefront in a frame (Vitrin › Önizleme) but is never framed itself;
  // storefront pages can only be framed by this origin (clickjacking from other sites stays blocked).
  const isAdmin = request.nextUrl.pathname.startsWith("/admin");

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...(isDev ? ["ws:", "wss:"] : []), ...CAPTCHA_CSP, ...(isAdmin ? [] : TRACKING_CSP.connectSrc)],
    "frame-src": isAdmin ? ["'self'", ...CAPTCHA_CSP] : [...CAPTCHA_CSP, ...TRACKING_CSP.frameSrc],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": [isAdmin ? "'none'" : "'self'"],
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
