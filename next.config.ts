import type { NextConfig } from "next"

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
	// Docker image ships .next/standalone (server.js + only the traced node_modules), see Dockerfile.
	output: "standalone",
	// kept as a real package in .next/standalone/node_modules: scripts/create-admin.mjs imports it inside the container
	serverExternalPackages: ["bcryptjs"],
	// runtime data and local env files never belong in the image (the Docker build context excludes them too)
	outputFileTracingExcludes: { "/*": ["data/**/*", ".env*"] },
	poweredByHeader: false,
	images: {
		// Uploaded images are served as-is from /assets (MEDIA_DIR); no image optimiser is configured.
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

