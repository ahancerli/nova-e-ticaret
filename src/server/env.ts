import "server-only"
import { resolve } from "node:path"
import { FsObjectStorage } from "@/modules/media"
import { SqliteDriver, openSqlite } from "./sqlite-driver"

type Bindings = Pick<RuntimeEnv, "DB" | "MEDIA_STORAGE">

const g = globalThis as typeof globalThis & { __novaRuntime?: Bindings }

// turbopackIgnore: a runtime path, not a file to trace into the standalone output
const dataPath = (key: string, fallback: string): string => resolve(/* turbopackIgnore: true */ process.cwd(), process.env[key] || fallback)

/**
 * One SQLite connection and one media directory per process. Kept on globalThis so `next dev` module reloads reuse
 * the open connection (tests put their in-memory database there before importing the app).
 */
function bindings(): Bindings {
	return (g.__novaRuntime ??= {
		DB: new SqliteDriver(openSqlite(dataPath("DATABASE_PATH", "data/nova.db"))),
		MEDIA_STORAGE: new FsObjectStorage(dataPath("MEDIA_DIR", "data/uploads")),
	})
}

/**
 * Bindings + secrets for the current request: database and media storage, the rest from process.env
 * (.env.local in `next dev`, env_file / environment in Docker). Everything else reads typed config via ConfigToken.
 */
export async function getEnv(): Promise<RuntimeEnv> {
	return {
		...bindings(),
		APP_ENV: process.env.APP_ENV === "production" ? "production" : "development",
		PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL || "http://localhost:3000",
		SESSION_SECRET: process.env.SESSION_SECRET || "",
		SECRETS_MASTER_KEY: process.env.SECRETS_MASTER_KEY || "",
		SECRETS_KEY_VERSION: process.env.SECRETS_KEY_VERSION || "v1",
		CRON_SECRET: process.env.CRON_SECRET || "",
	}
}
