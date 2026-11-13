// Calls the scheduled jobs (POST /api/cron/*, Authorization: Bearer CRON_SECRET) on their intervals.
// Runs as its own container next to the app (docker-compose.yml → scheduler); locally: npm run scheduler.
// A job never overlaps itself: the next run is planned only after the previous one has answered.
//   APP_URL       base URL of the app (Docker: http://app:3000, local: http://localhost:3000)
//   CRON_SECRET   same value as the app
import { loadEnv, requireEnv } from "./env.mjs"

loadEnv()
requireEnv("CRON_SECRET")

const BASE = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")
const SECRET = process.env.CRON_SECRET
const TIMEOUT_MS = 120_000

/** path → interval in seconds (README §2 "Zamanlanmış işler"). */
const JOBS = [
	{ path: "/api/cron/outbox", every: 60 },
	{ path: "/api/cron/integrations", every: 60 },
	{ path: "/api/cron/expire", every: 300 },
	{ path: "/api/cron/feeds-sync", every: 900 },
	{ path: "/api/cron/shipping-sync", every: 1200 },
]

const log = (level, msg, extra = {}) =>
	console.log(JSON.stringify({ time: new Date().toISOString(), level, source: "scheduler", msg, ...extra }))

async function runJob(job) {
	const started = Date.now()
	try {
		const res = await fetch(BASE + job.path, {
			method: "POST",
			headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
			body: "{}",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
		const body = (await res.text()).slice(0, 500)
		log(res.ok ? "info" : "warn", "cron", { job: job.path, status: res.status, ms: Date.now() - started, ...(res.ok ? {} : { body }) })
	} catch (e) {
		log("error", "cron", { job: job.path, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) })
	}
}

function schedule(job, delayMs) {
	setTimeout(async () => {
		await runJob(job)
		schedule(job, job.every * 1000)
	}, delayMs)
}

async function waitForApp() {
	for (;;) {
		try {
			const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) })
			if (res.ok) return
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 3000))
	}
}

log("info", "waiting for app", { base: BASE })
await waitForApp()
log("info", "started", { jobs: JOBS.map((j) => `${j.path} every ${j.every}s`) })
// spread the first runs a little so they do not all hit the database in the same second
JOBS.forEach((job, i) => schedule(job, 2000 + i * 3000))

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		log("info", "stopping", { signal })
		process.exit(0)
	})
}
