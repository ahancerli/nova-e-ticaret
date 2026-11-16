import { ListConversationsToken, conversationQuerySchema } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

const dayStart = (d: string) => new Date(Date.parse(`${d}T00:00:00+03:00`)).toISOString();

/** GET — conversations of both channels (filters: channel, status, ad / post source, Istanbul days, text). */
export const GET = route({
  auth: { audience: "admin", permission: "social_ai.chat" },
  query: conversationQuerySchema,
  handle: ({ query, resolve }) => resolve(ListConversationsToken).execute({
    channel: query.channel, status: query.status, source: query.source, q: query.q || undefined, page: query.page, pageSize: query.pageSize,
    from: query.from ? dayStart(query.from) : undefined, to: query.to ? new Date(Date.parse(dayStart(query.to)) + 86_400_000).toISOString() : undefined,
  }),
});
