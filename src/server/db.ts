import "server-only"
import { getCloudflareContext } from "@opennextjs/cloudflare"

/**
 * D1 access. Only server code imports this module ("server-only" guard).
 *
 * Rules (from the handoff spec, adapted to D1):
 *  - Always bind parameters (`?`) — never interpolate user input into SQL.
 *  - Multi-statement writes that must be atomic go through `db.batch([...])`;
 *    D1 runs a batch as one transaction and rolls back on the first error
 *    (including RAISE(ABORT, ...) from schema triggers).
 *  - D1 limits: max 100 bound parameters per statement, keep IN() lists small.
 */
export async function getEnv(): Promise<CloudflareEnv> {
	const { env } = await getCloudflareContext({ async: true })
	const e = env as Partial<CloudflareEnv>
	return {
		...e,
		APP_ENV: e.APP_ENV ?? ((process.env.APP_ENV as CloudflareEnv["APP_ENV"]) || "development"),
		PUBLIC_SITE_URL: e.PUBLIC_SITE_URL || process.env.PUBLIC_SITE_URL || "http://localhost:3000",
		SESSION_SECRET: e.SESSION_SECRET || process.env.SESSION_SECRET || "",
		SECRETS_MASTER_KEY: e.SECRETS_MASTER_KEY || process.env.SECRETS_MASTER_KEY || "",
		SECRETS_KEY_VERSION: e.SECRETS_KEY_VERSION || process.env.SECRETS_KEY_VERSION || "v1",
		CRON_SECRET: e.CRON_SECRET || process.env.CRON_SECRET || "",
	} as CloudflareEnv
}

export async function getDb(): Promise<D1Database> {
	return (await getEnv()).DB
}

export async function queryAll<T>(sql: string, ...params: unknown[]): Promise<T[]> {
	const db = await getDb()
	const { results } = await db
		.prepare(sql)
		.bind(...params)
		.all<T>()
	return results ?? []
}

export async function queryFirst<T>(sql: string, ...params: unknown[]): Promise<T | null> {
	const db = await getDb()
	return (
		(await db
			.prepare(sql)
			.bind(...params)
			.first<T>()) ?? null
	)
}

export async function execute(sql: string, ...params: unknown[]): Promise<D1Result> {
	const db = await getDb()
	return db
		.prepare(sql)
		.bind(...params)
		.run()
}

/** Builds `?,?,?` for IN lists. */
export function placeholders(n: number): string {
	if (n < 1 || n > 90) throw new Error("placeholder count out of range")
	return Array.from({ length: n }, () => "?").join(",")
}

/** Maps trigger RAISE(ABORT, 'code') messages and constraint errors to stable codes. */
export function dbErrorCode(err: unknown): string | null {
	const msg = err instanceof Error ? err.message : String(err)
	const known = [
		"insufficient_stock",
		"campaign_capacity_exceeded",
		"coupon_limit_reached",
		"coupon_customer_limit_reached",
		"coupon_inactive",
		"reservation_terminal",
		"payment_paid_terminal",
		"order_snapshot_immutable",
		"category_cycle",
		"campaign_without_targets",
	]
	for (const code of known) if (msg.includes(code)) return code
	if (msg.includes("UNIQUE constraint failed")) return "conflict"
	if (msg.includes("FOREIGN KEY constraint failed")) return "invalid_reference"
	if (msg.includes("CHECK constraint failed")) return "invalid_value"
	return null
}
