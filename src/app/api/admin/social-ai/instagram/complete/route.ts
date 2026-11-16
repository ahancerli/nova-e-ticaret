import { z } from "zod";
import { actorOf } from "@/modules/shared/actor";
import { CompleteInstagramLoginToken } from "@/modules/social-ai";
import { route } from "@/server/app";
import { readStateCookie } from "../state-cookie";

export const dynamic = "force-dynamic";

/** POST — finish "Instagram ile bağlan": the state must match the signed cookie set at the start, then the code is exchanged. */
export const POST = route({
  auth: { audience: "admin", permission: "social_ai.manage" },
  body: z.object({ code: z.string().max(2000).nullish(), state: z.string().max(400).nullish(), denied: z.boolean().optional() }).strict(),
  rateLimit: { name: "social-ai-connect", limit: 10, windowSec: 60 },
  handle: (ctx) => ctx.resolve(CompleteInstagramLoginToken).execute(
    { code: ctx.body.code ?? null, state: ctx.body.state ?? null, cookieState: readStateCookie(ctx.req), denied: ctx.body.denied === true }, actorOf(ctx),
  ),
});
