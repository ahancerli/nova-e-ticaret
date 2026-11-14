import "server-only";
import {
  GraphQLError, Kind, NoSchemaIntrospectionCustomRule, buildSchema, parse, specifiedRules, subscribe, validate,
  type DocumentNode, type ExecutionResult,
} from "graphql";
import { AppError, BadRequestError, ForbiddenError, type Principal } from "@/core";
import { PRESENCE_CHANNEL, STAFF_CHANNEL, customerChannel, type SupportEvent, type SupportHub } from "@/modules/support";

/**
 * Live graph: GraphQL subscriptions delivered over Server-Sent Events (graphql-sse "distinct connections" format:
 * `event: next` + ExecutionResult JSON, `event: complete`). Next route handlers cannot upgrade to WebSocket, while a
 * streamed Response works everywhere the app runs (dev server, standalone, behind Caddy over HTTP/2). Writes stay on
 * REST; after a reconnect clients fetch what they missed by message seq, so the stream itself never replays.
 */
export const realtimeSchema = buildSchema(/* GraphQL */ `
  type Query {
    "This graph serves subscriptions only."
    ok: Boolean!
  }

  enum SupportSender { customer staff }
  enum SupportStatus { open closed }
  enum SupportEventKind { message read typing status presence }

  type SupportMessage {
    id: ID!
    conversationId: ID!
    "Position in the conversation (1, 2, 3 ...)."
    seq: Int!
    sender: SupportSender!
    authorName: String
    body: String!
    clientId: String!
    createdAt: String!
  }

  "Panel inbox row; only staff streams carry it."
  type SupportConversation {
    id: ID!
    customerId: ID!
    customerName: String!
    status: SupportStatus!
    assigneeName: String
    pagePath: String
    lastSeq: Int!
    lastMessageAt: String
    lastPreview: String
    lastSender: SupportSender
    staffUnread: Int!
    customerReadSeq: Int!
    createdAt: String!
  }

  type SupportEvent {
    kind: SupportEventKind!
    conversationId: ID
    message: SupportMessage
    conversation: SupportConversation
    readSeq: Int
    reader: SupportSender
    typing: SupportSender
    status: SupportStatus
    agentsOnline: Boolean
  }

  type Subscription {
    "Signed-in member: events of their own conversations and agent presence."
    mySupport: SupportEvent!
    "Staff with support.chat: every conversation change."
    supportInbox: SupportEvent!
  }
`);

export interface RealtimeContext {
  audience: "storefront" | "admin";
  user: Principal;
  hub: SupportHub;
  signal: AbortSignal;
}

async function* wrap(field: string, source: AsyncGenerator<SupportEvent, void, void>) {
  for await (const e of source) yield { [field]: e };
}

const rootValue = {
  ok: () => true,
  mySupport: (_args: unknown, ctx: RealtimeContext) => {
    if (ctx.audience !== "storefront") throw new ForbiddenError();
    return wrap("mySupport", ctx.hub.subscribe([customerChannel(ctx.user.id), PRESENCE_CHANNEL], ctx.signal));
  },
  supportInbox: (_args: unknown, ctx: RealtimeContext) => {
    if (ctx.audience !== "admin" || !ctx.user.permissions.has("support.chat")) throw new ForbiddenError();
    return wrap("supportInbox", ctx.hub.subscribe([STAFF_CHANNEL], ctx.signal));
  },
};

const parseCache = new Map<string, DocumentNode>();

function prepare(query: string, introspection: boolean): DocumentNode {
  const cached = parseCache.get(query);
  if (cached) return cached;
  let document: DocumentNode;
  try {
    document = parse(query, { maxTokens: 400, noLocation: true });
  } catch (e) {
    throw new BadRequestError("graphql_syntax", "Sorgu okunamadı.", { details: { reason: (e as Error).message } });
  }
  const errors = validate(realtimeSchema, document, introspection ? specifiedRules : [...specifiedRules, NoSchemaIntrospectionCustomRule]);
  if (errors.length) throw new BadRequestError("graphql_invalid", "Sorgu geçersiz.", { details: { errors: errors.map((e) => e.message) } });
  const ops = document.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION);
  if (ops.length !== 1 || ops[0]?.operation !== "subscription") throw new BadRequestError("graphql_invalid", "Bu adres yalnızca tek bir subscription kabul eder.");
  if (parseCache.size > 50) parseCache.clear();
  parseCache.set(query, document);
  return document;
}

const HEARTBEAT_MS = 20_000;
/** Streams end after this long; EventSource reconnects at once, which re-checks the session. */
const MAX_LIFETIME_MS = 15 * 60_000;

function raise(result: ExecutionResult): never {
  const cause = result.errors?.[0]?.originalError;
  if (cause instanceof AppError) throw cause;
  if (cause && !(cause instanceof GraphQLError)) throw cause;
  throw new BadRequestError("graphql_invalid", "Sorgu geçersiz.", { details: { errors: result.errors?.map((e) => e.message) ?? [] } });
}

/**
 * Starts the subscription inside the request (authorization errors still become normal JSON 4xx answers) and returns
 * the event stream. The hub listener is registered before the response leaves, so nothing published after the
 * client sees `open` can be missed.
 */
export async function streamSubscription(
  req: Request, input: { query: string; variables?: Record<string, unknown> }, ctx: Omit<RealtimeContext, "signal">,
): Promise<Response> {
  const document = prepare(input.query, process.env.NODE_ENV !== "production");
  const abort = new AbortController();
  const stop = () => abort.abort();
  req.signal.addEventListener("abort", stop, { once: true });

  const result = await subscribe({ schema: realtimeSchema, document, rootValue, contextValue: { ...ctx, signal: abort.signal }, variableValues: input.variables });
  if (!(Symbol.asyncIterator in result)) {
    stop();
    raise(result);
  }
  const events = result;
  const encoder = new TextEncoder();
  let ping: ReturnType<typeof setInterval> | undefined;
  let ttl: ReturnType<typeof setTimeout> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try { controller.enqueue(encoder.encode(chunk)); } catch { stop(); }
      };
      send("retry: 2000\n: connected\n\n");
      ping = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      ttl = setTimeout(stop, MAX_LIFETIME_MS);
      void (async () => {
        try {
          for await (const r of events) send(`event: next\ndata: ${JSON.stringify(r)}\n\n`);
        } finally {
          clearInterval(ping);
          clearTimeout(ttl);
          req.signal.removeEventListener("abort", stop);
          send("event: complete\ndata:\n\n");
          try { controller.close(); } catch { /* already closed by the client */ }
        }
      })();
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // no-transform: Next's compression would otherwise buffer the stream
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

/** `variables` arrives as a JSON string in the query string. */
export function parseVariables(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new BadRequestError("graphql_invalid", "Değişkenler okunamadı.");
}
