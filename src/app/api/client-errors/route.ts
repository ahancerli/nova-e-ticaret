import { z } from "zod";
import { reply } from "@/core";
import { route } from "@/server/app";
import { errorReporter } from "@/server/error-reporter";

export const dynamic = "force-dynamic";

const report = z.object({
  kind: z.enum(["render", "uncaught", "unhandled_rejection", "boundary"]),
  message: z.string().max(500),
  name: z.string().max(100).optional(),
  stack: z.string().max(4000).optional(),
  digest: z.string().max(100).optional(),
  boundary: z.string().max(100).optional(),
  path: z.string().max(300).optional(),
}).strict();

/**
 * POST /api/client-errors — browser error reports (src/lib/error-reporting.ts) into the server log and the error
 * monitor (SENTRY_DSN).
 * Public by design (errors happen before / without login), so it is same-origin only, size- and
 * rate-limited per IP, and stores nothing in the database.
 */
export const POST = route({
  body: report,
  bodyLimit: 8 * 1024,
  rateLimit: { name: "client-errors", limit: 30, windowSec: 60 },
  handle: async ({ body, logger, req }) => {
    const { message, ...rest } = body;
    const userAgent = req.headers.get("user-agent")?.slice(0, 200);
    logger.warn("client error", { ...rest, errorMessage: message, userAgent });
    errorReporter().capture({
      message: `Tarayıcı: ${message}`, stack: rest.stack, tags: { source: "browser", kind: rest.kind, boundary: rest.boundary },
      extra: { path: rest.path, digest: rest.digest, name: rest.name, userAgent },
    });
    return reply.accepted({ received: true });
  },
});
