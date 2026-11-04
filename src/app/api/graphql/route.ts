import { z } from "zod";
import { route } from "@/server/app";
import { runGraph } from "@/server/graphql/execute";

export const dynamic = "force-dynamic";

const body = z.object({
  query: z.string().min(1).max(8_000),
  variables: z.record(z.string(), z.unknown()).nullish(),
  operationName: z.string().max(100).nullish(),
});

/**
 * POST /api/graphql — read-only storefront graph (schema: src/server/graphql/schema.ts).
 * Same pipeline as every JSON route: Origin/JSON CSRF guard, Zod body, `{data, meta, requestId}` envelope.
 * Introspection only outside production.
 */
export const POST = route({
  body,
  bodyLimit: 16_384,
  handle: ({ body, resolve }) => runGraph(body, { resolve }, { introspection: process.env.NODE_ENV !== "production" }),
});
