import type { Instrumentation } from "next";

/**
 * Server render errors (server components, proxy) → error monitor. Route handler errors never reach this hook: route()
 * answers them itself and its `logger.error` line is reported instead (src/server/app.ts).
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  const { errorReporter } = await import("./server/error-reporter");
  const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : undefined;
  errorReporter().capture({
    message: err instanceof Error ? err.message : String(err),
    error: err,
    request: { url: request.path.split("?")[0], method: request.method },
    tags: { source: "render", route: context.routePath, routeType: context.routeType, digest },
  });
};
