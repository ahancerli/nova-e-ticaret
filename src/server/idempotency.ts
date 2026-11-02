import "server-only";
import { IdempotencyStoreToken } from "@/core";
import { resolveService } from "./app";

/** Legacy facade over the platform IdempotencyStore. New routes declare `idempotency` on route(). */
export async function withIdempotency<T>(req: Request, scope: string, body: unknown, run: () => Promise<{ status: number; data: T }>) {
  return (await resolveService(IdempotencyStoreToken)).run(req, scope, body, run);
}
