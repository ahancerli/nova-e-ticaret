import type { NextConfig } from "next"
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare"

type Header = { key: string; value: string }

// Page CSP (with a per-request script nonce) is set by src/proxy.ts. Everything the proxy does not
// match — API JSON, public files — gets this policy: it never needs to run script or be framed.
const LOCKED_DOWN_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

function buildSecurityHeaders(isDev: boolean): Header[] {
	const headers: Header[] = [
		{ key: "X-Content-Type-Options", value: "nosniff" },
		{ key: "X-Frame-Options", value: "DENY" },
		{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
		{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
		{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
	]
	if (!isDev) {
		headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" })
	}
	return headers
}

const nextConfig: NextConfig = {
	poweredByHeader: false,
	images: {
		// Cloudflare Images binding can be wired later (see wrangler.jsonc "images").
		unoptimized: true,
	},
	async headers() {
		const isDev = process.env.NODE_ENV !== "production"
		const lockedDown = [{ key: "Content-Security-Policy", value: LOCKED_DOWN_CSP }]
		return [
			{ source: "/:path*", headers: buildSecurityHeaders(isDev) },
			{ source: "/api/:path*", headers: lockedDown },
			{ source: "/demo/:path*", headers: lockedDown },
		]
	},
}

export default nextConfig

// Gives `next dev` access to the bindings in wrangler.jsonc (local or remote D1, see scripts/sync-wrangler.mjs).
initOpenNextCloudflareForDev()
