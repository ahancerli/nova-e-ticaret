import { reply } from "@/core";
import { ListSectionsToken, SaveSectionToken, sectionSchema } from "@/modules/showcase";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** Home page sections in display order. */
export const GET = route({ auth: { audience: "admin", permission: "storefront.write" }, handle: async ({ resolve }) => reply.ok(await resolve(ListSectionsToken).execute()) });

export const POST = route({
  auth: { audience: "admin", permission: "storefront.write" },
  body: sectionSchema,
  handle: async (ctx) => reply.created(await ctx.resolve(SaveSectionToken).execute(null, ctx.body, actorOf(ctx))),
});
