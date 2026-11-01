import type { NextConfig } from "next"
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare"

type Header = { key: string; value: string }

function cspValue(directives: Record<string, string[]>): string {
	return Object.entries(directives)
		.map(([name, values]) => `${name} ${values.join(" ")}`)
		.join("; ")
}

function buildSecurityHeaders(isDev: boolean): Header[] {
	const baseHeaders: Header[] = [
		{ key: "X-Content-Type-Options", value: "nosniff" },
		{ key: "X-Frame-Options", value: "DENY" },
		{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
		{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
	]

	const cspDirectives: Record<string, string[]> = {
		"default-src": ["'self'"],
		"img-src": ["'self'", "data:", "https:"],
		"style-src": ["'self'", "'unsafe-inline'"],
		"script-src": ["'self'", "'unsafe-inline'", "https://*.iyzipay.com"],
		"frame-src": ["https://*.iyzipay.com"],
		"connect-src": ["'self'"],
		"form-action": ["'self'", "https://*.iyzipay.com"],
		"frame-ancestors": ["'none'"],
		"base-uri": ["'self'"],
	}

	if (isDev) {
		// React/Next dev tooling needs eval and HMR websocket channels in development only.
		const scriptSrc = cspDirectives["script-src"]
		const connectSrc = cspDirectives["connect-src"]
		if (scriptSrc) scriptSrc.push("'unsafe-eval'")
		if (connectSrc) connectSrc.push("ws:", "wss:", "http://localhost:*", "https://localhost:*")
	} else {
		baseHeaders.push({
			key: "Strict-Transport-Security",
			value: "max-age=63072000; includeSubDomains; preload",
		})
	}

	baseHeaders.push({ key: "Content-Security-Policy", value: cspValue(cspDirectives) })
	return baseHeaders
}

const nextConfig: NextConfig = {
	poweredByHeader: false,
	images: {
		// Cloudflare Images binding can be wired later (see wrangler.jsonc "images").
		unoptimized: true,
	},
	async headers() {
		const isDev = process.env.NODE_ENV !== "production"
		return [{ source: "/:path*", headers: buildSecurityHeaders(isDev) }]
	},
}

export default nextConfig

// Gives `next dev` access to the bindings in wrangler.jsonc.
// The D1 binding there has "remote": true, so local dev talks to the real Cloudflare D1.
initOpenNextCloudflareForDev()
