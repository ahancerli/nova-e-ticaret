import { reply } from "@/core";
import { CreateAttributeToken, ListAttributesToken, attributeCreateSchema } from "@/modules/catalog";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET/POST /api/admin/attributes — product attributes and variant axes (Katalog › Özellikler). */
export const GET = route({
  auth: { audience: "admin", permission: "catalog.read" },
  handle: async ({ resolve }) => {
    const rows = await resolve(ListAttributesToken).execute();
    return reply.ok(rows, { total: rows.length });
  },
});

export const POST = route({
  auth: { audience: "admin", permission: "catalog.write" },
  body: attributeCreateSchema,
  bodyLimit: 128 * 1024,
  handle: async (ctx) => reply.created(await ctx.resolve(CreateAttributeToken).execute(ctx.body, actorOf(ctx))),
});
