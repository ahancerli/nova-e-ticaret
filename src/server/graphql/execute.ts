import "server-only";
import {
  GraphQLError, NoSchemaIntrospectionCustomRule, execute, parse, specifiedRules, validate,
  type ASTVisitor, type DocumentNode, type ValidationContext, type ValidationRule,
} from "graphql";
import { AppError, BadRequestError } from "@/core";
import { rootValue, schema, type GraphContext } from "./schema";

export interface GraphRequest {
  query: string;
  variables?: Record<string, unknown> | null;
  operationName?: string | null;
}

const MAX_DEPTH = 6;
const MAX_TOKENS = 1500;

/** Rejects deeply nested selections (Category.children recursion) before anything executes. */
function depthLimit(max: number): ValidationRule {
  return (context: ValidationContext): ASTVisitor => {
    let depth = 0;
    return {
      SelectionSet: {
        enter(node) {
          depth++;
          if (depth > max) context.reportError(new GraphQLError(`Sorgu en fazla ${max} seviye derin olabilir.`, { nodes: [node] }));
        },
        leave() { depth--; },
      },
    };
  };
}

const parseCache = new Map<string, DocumentNode>();

/** Parse + validate once per distinct query text (clients send a handful of fixed documents). */
function prepare(query: string, introspection: boolean): DocumentNode {
  const key = `${introspection ? 1 : 0}:${query}`;
  const cached = parseCache.get(key);
  if (cached) return cached;
  let document: DocumentNode;
  try {
    document = parse(query, { maxTokens: MAX_TOKENS, noLocation: true });
  } catch (e) {
    throw new BadRequestError("graphql_syntax", "Sorgu okunamadı.", { details: { reason: (e as Error).message } });
  }
  const rules = [...specifiedRules, depthLimit(MAX_DEPTH), ...(introspection ? [] : [NoSchemaIntrospectionCustomRule])];
  const errors = validate(schema, document, rules);
  if (errors.length) throw new BadRequestError("graphql_invalid", "Sorgu geçersiz.", { details: { errors: errors.map((e) => e.message) } });
  if (parseCache.size > 200) parseCache.clear();
  parseCache.set(key, document);
  return document;
}

/**
 * Runs a read query inside the caller's request scope. The response keeps the project's envelope
 * (`{data, meta, requestId}` via route()), so the first resolver error is rethrown as the AppError it
 * was (404, 422 …) instead of GraphQL's partial-data `errors` array.
 */
export async function runGraph(req: GraphRequest, ctx: GraphContext, opts: { introspection: boolean }): Promise<unknown> {
  const document = prepare(req.query, opts.introspection);
  const result = await execute({ schema, document, rootValue, contextValue: ctx, variableValues: req.variables ?? undefined, operationName: req.operationName ?? undefined });
  const first = result.errors?.[0];
  if (first) {
    const cause = first.originalError;
    if (cause instanceof AppError) throw cause; // keeps its status (404, 422 …)
    if (cause && !(cause instanceof GraphQLError)) throw cause; // resolver bug → logged 500
    throw new BadRequestError("graphql_invalid", "Sorgu geçersiz.", { details: { errors: result.errors!.map((e) => e.message) } });
  }
  return result.data;
}
