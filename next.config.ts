import type { NextConfig } from "next"
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare"

type Header = { key: string; value: string }

// Page CSP (with a per-request script nonce) is set by src/proxy.ts. Everything the proxy does not
// match — API JSON, public files — gets this policy: it never needs to run script or be framed.
const LOCKED_DOWN_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

function buildSecurityHeaders(isDev: boolean): Header[] {
	const headers: Header[] = [
		{ key: "X-Content-Type-Options", value: "nosniff" },
		// storefront pages may be framed by the panel's device preview (same origin); /admin stays DENY below
		{ key: "X-Frame-Options", value: "SAMEORIGIN" },
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
			// later entries override earlier ones for the same header key
			{ source: "/admin/:path*", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
			{ source: "/demo/:path*", headers: lockedDown },
		]
	},
}

export default nextConfig

// Gives `next dev` access to the bindings in wrangler.jsonc (local or remote D1, see scripts/sync-wrangler.mjs).
// NOVA_PERSIST_DIR points local D1 / R2 at a separate state folder — the browser tests (npm run test:e2e) use
// .wrangler/e2e so they never touch the developer's local database. Same meaning as `wrangler --persist-to`;
// getPlatformProxy wants the versioned sub-folder itself (its default is ".wrangler/state/v3").
initOpenNextCloudflareForDev(process.env.NOVA_PERSIST_DIR ? { persist: { path: `${process.env.NOVA_PERSIST_DIR}/v3` } } : undefined)
