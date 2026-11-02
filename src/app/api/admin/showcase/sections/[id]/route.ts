import { DeleteSectionToken, SaveSectionToken, ToggleSectionToken, sectionSchema, toggleSchema } from "@/modules/showcase";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT — full update with expectedUpdatedAt (409 section_changed). */
export const PUT = route({ auth: { audience: "admin", permission: "storefront.write" }, params: idParams, body: sectionSchema, handle: (ctx) => ctx.resolve(SaveSectionToken).execute(ctx.params.id, ctx.body, actorOf(ctx)) });

/** PATCH { isActive } — quick on/off from the list. */
export const PATCH = route({
  auth: { audience: "admin", permission: "storefront.write" }, params: idParams, body: toggleSchema,
  handle: async (ctx) => { await ctx.resolve(ToggleSectionToken).execute(ctx.params.id, ctx.body.isActive, actorOf(ctx)); return { updated: true }; },
});

export const DELETE = route({
  auth: { audience: "admin", permission: "storefront.write" }, params: idParams,
  handle: async (ctx) => { await ctx.resolve(DeleteSectionToken).execute(ctx.params.id, actorOf(ctx)); return { deleted: true }; },
});
