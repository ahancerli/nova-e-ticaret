import { reply } from "@/core";
import { CreateStoryCollectionToken, ListStoryCollectionsToken, nameSchema } from "@/modules/showcase";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({ auth: { audience: "admin", permission: "storefront.write" }, handle: async ({ resolve }) => reply.ok(await resolve(ListStoryCollectionsToken).execute()) });
export const POST = route({ auth: { audience: "admin", permission: "storefront.write" }, body: nameSchema, handle: async (ctx) => reply.created(await ctx.resolve(CreateStoryCollectionToken).execute(ctx.body.name, actorOf(ctx))) });
