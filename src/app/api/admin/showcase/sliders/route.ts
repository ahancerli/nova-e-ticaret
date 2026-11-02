import { reply } from "@/core";
import { CreateSliderToken, ListSlidersToken, nameSchema } from "@/modules/showcase";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({ auth: { audience: "admin", permission: "storefront.write" }, handle: async ({ resolve }) => reply.ok(await resolve(ListSlidersToken).execute()) });
export const POST = route({ auth: { audience: "admin", permission: "storefront.write" }, body: nameSchema, handle: async (ctx) => reply.created(await ctx.resolve(CreateSliderToken).execute(ctx.body.name, actorOf(ctx))) });
