import { SupportHubToken, supportStreamQuerySchema } from "@/modules/support";
import { route } from "@/server/app";
import { parseVariables, streamSubscription } from "@/server/graphql/realtime";

export const dynamic = "force-dynamic";

/** GET — GraphQL subscription `supportInbox` as Server-Sent Events. While open, the agent counts as online for the shop. */
export const GET = route({
  auth: { audience: "admin", permission: "support.chat" },
  rateLimit: { name: "support-stream-admin", limit: 30, windowSec: 60 },
  query: supportStreamQuerySchema,
  handle: ({ req, query, user, resolve }) =>
    streamSubscription(req, { query: query.query, variables: parseVariables(query.variables) }, { audience: "admin", user: user!, hub: resolve(SupportHubToken) }),
});
