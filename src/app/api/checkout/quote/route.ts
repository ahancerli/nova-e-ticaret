import { handler, ok } from "@/server/http";
import { assertSameOrigin } from "@/server/security";
import { createQuote } from "@/server/services/checkout";

export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  await assertSameOrigin(req);
  return ok(req, await createQuote());
});
