import { NotFoundError } from "@/core";
import { GetStaffToken, UpdateStaffToken, staffUpdateSchema } from "@/modules/staff";
import { actorOf } from "@/modules/shared/actor";
import { idParams } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "users.manage" },
  params: idParams,
  handle: async ({ params, resolve }) => {
    const s = await resolve(GetStaffToken).execute(params.id);
    if (!s) throw new NotFoundError("staff_not_found", "Kullanıcı bulunamadı.");
    return s;
  },
});

export const PATCH = route({
  auth: { audience: "admin", permission: "users.manage" },
  params: idParams,
  body: staffUpdateSchema,
  handle: async (ctx) => {
    await ctx.resolve(UpdateStaffToken).execute(ctx.params.id, ctx.body, actorOf(ctx));
    return { updated: true };
  },
});
