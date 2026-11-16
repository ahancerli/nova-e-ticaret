import { actorOf } from "@/modules/shared/actor";
import { SaveMetaAppToken, metaAppSchema } from "@/modules/social-ai";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT — the shop's Meta app (ids + secrets). Secrets are sealed and never returned; empty = keep the stored one. */
export const PUT = route({
  auth: { audience: "admin", permission: "social_ai.manage" },
  body: metaAppSchema,
  handle: (ctx) => ctx.resolve(SaveMetaAppToken).execute({
    appId: ctx.body.appId || null, appSecret: ctx.body.appSecret, igAppId: ctx.body.igAppId || null, igAppSecret: ctx.body.igAppSecret, waConfigId: ctx.body.waConfigId || null,
    expectedUpdatedAt: ctx.body.expectedUpdatedAt,
  }, actorOf(ctx)),
});
