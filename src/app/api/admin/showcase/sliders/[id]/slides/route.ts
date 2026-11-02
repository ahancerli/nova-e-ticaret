import { reply } from "@/core";
import { SaveSlideToken, slideSchema } from "@/modules/showcase";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const POST = route({ auth: { audience: "admin", permission: "storefront.write" }, params: idParams, body: slideSchema, handle: async (ctx) => reply.created(await ctx.resolve(SaveSlideToken).execute(ctx.params.id, null, ctx.body, actorOf(ctx))) });
