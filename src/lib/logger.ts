import "server-only"

export function logError(scope: string, err: unknown, meta?: Record<string, unknown>): void {
	const base =
		err instanceof Error ? { name: err.name, message: err.message } : { value: String(err) }
	// Keep logs structured so server-side collectors can parse easily.
	console.error(`[${scope}]`, { ...base, ...(meta ?? {}) })
}
