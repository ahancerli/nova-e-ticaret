import { DeleteRoleToken, UpdateRoleToken, roleUpdateSchema } from "@/modules/staff";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const PUT = route({
  auth: { audience: "admin", permission: "users.manage" },
  params: idParams,
  body: roleUpdateSchema,
  handle: (ctx) => ctx.resolve(UpdateRoleToken).execute(ctx.params.id, ctx.body, actorOf(ctx)),
});

export const DELETE = route({
  auth: { audience: "admin", permission: "users.manage" },
  params: idParams,
  handle: async (ctx) => {
    await ctx.resolve(DeleteRoleToken).execute(ctx.params.id, actorOf(ctx));
    return { deleted: true };
  },
});
