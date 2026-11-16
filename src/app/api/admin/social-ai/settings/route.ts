import { actorOf } from "@/modules/shared/actor";
import { GetBotSettingsToken, UpdateBotSettingsToken, botSettingsSchema } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";
const auth = { audience: "admin", permission: "social_ai.manage" } as const;

/** GET — bot settings shared by both channels. */
export const GET = route({ auth, handle: (ctx) => ctx.resolve(GetBotSettingsToken).execute() });

/** PUT — update them (guarded by `expectedUpdatedAt`). */
export const PUT = route({ auth, body: botSettingsSchema, handle: (ctx) => ctx.resolve(UpdateBotSettingsToken).execute(ctx.body, actorOf(ctx)) });
