import { SupportHubToken, supportStreamQuerySchema } from "@/modules/support";
import { route } from "@/server/app";
import { parseVariables, streamSubscription } from "@/server/graphql/realtime";

export const dynamic = "force-dynamic";

/** GET — GraphQL subscription `mySupport` as Server-Sent Events (EventSource). Schema: src/server/graphql/realtime.ts. */
export const GET = route({
  auth: { audience: "storefront", required: true },
  rateLimit: { name: "support-stream", limit: 30, windowSec: 60 },
  query: supportStreamQuerySchema,
  handle: ({ req, query, user, resolve }) =>
    streamSubscription(req, { query: query.query, variables: parseVariables(query.variables) }, { audience: "storefront", user: user!, hub: resolve(SupportHubToken) }),
});
