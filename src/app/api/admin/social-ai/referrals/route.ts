import { reply } from "@/core";
import { actorOf } from "@/modules/shared/actor";
import { ListReferralMapsToken, SaveReferralMapToken, referralMapSchema } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";
const auth = { audience: "admin", permission: "social_ai.manage" } as const;

/** GET — ad / post → product mappings. */
export const GET = route({ auth, handle: (ctx) => ctx.resolve(ListReferralMapsToken).execute() });

/** POST — add a mapping. */
export const POST = route({ auth, body: referralMapSchema, handle: async (ctx) => reply.created(await ctx.resolve(SaveReferralMapToken).execute(null, ctx.body, actorOf(ctx))) });
