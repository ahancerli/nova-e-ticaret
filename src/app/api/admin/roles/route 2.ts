import { reply } from "@/core";
import { CreateRoleToken, ListRolesToken, roleCreateSchema } from "@/modules/staff";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "users.manage" },
  handle: async ({ resolve }) => {
    const rows = await resolve(ListRolesToken).execute();
    return reply.ok(rows, { total: rows.length });
  },
});

export const POST = route({
  auth: { audience: "admin", permission: "users.manage" },
  body: roleCreateSchema,
  handle: async (ctx) => reply.created(await ctx.resolve(CreateRoleToken).execute(ctx.body, actorOf(ctx))),
});
