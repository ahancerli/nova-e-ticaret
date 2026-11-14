import { RemoveTrackingTagToken, SaveTrackingTagToken, tagCodeParams, trackingTagDeleteSchema, trackingTagSaveSchema } from "@/modules/consent";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** PUT /api/admin/consent/tags/:code — add / update a vendor tag (ids only). Activating a new vendor renews consent. */
export const PUT = route({
  auth: { audience: "admin", permission: "integrations.write" },
  params: tagCodeParams,
  body: trackingTagSaveSchema,
  handle: (ctx) => ctx.resolve(SaveTrackingTagToken).execute(ctx.params.code, ctx.body, actorOf(ctx)),
});

export const DELETE = route({
  auth: { audience: "admin", permission: "integrations.write" },
  params: tagCodeParams,
  body: trackingTagDeleteSchema,
  handle: (ctx) => ctx.resolve(RemoveTrackingTagToken).execute(ctx.params.code, ctx.body.expectedUpdatedAt, actorOf(ctx)),
});
