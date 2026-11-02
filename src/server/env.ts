import "server-only"
import { getCloudflareContext } from "@opennextjs/cloudflare"

/**
 * Worker bindings + secrets for the current request. In local `next dev` the secrets come from .env.local
 * (process.env) when the binding does not provide them. Everything else reads typed config via ConfigToken.
 */
export async function getEnv(): Promise<CloudflareEnv> {
	const { env } = await getCloudflareContext({ async: true })
	const e = env as Partial<CloudflareEnv>
	return {
		...e,
		// .env.local wins over the wrangler.jsonc vars (which carry production values even in local dev).
		APP_ENV: (process.env.APP_ENV as CloudflareEnv["APP_ENV"]) || e.APP_ENV || "development",
		PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL || e.PUBLIC_SITE_URL || "http://localhost:3000",
		SESSION_SECRET: e.SESSION_SECRET || process.env.SESSION_SECRET || "",
		SECRETS_MASTER_KEY: e.SECRETS_MASTER_KEY || process.env.SECRETS_MASTER_KEY || "",
		SECRETS_KEY_VERSION: e.SECRETS_KEY_VERSION || process.env.SECRETS_KEY_VERSION || "v1",
		CRON_SECRET: e.CRON_SECRET || process.env.CRON_SECRET || "",
	} as CloudflareEnv
}
