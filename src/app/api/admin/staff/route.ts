import { reply } from "@/core";
import { InviteStaffToken, ListStaffToken, staffInviteSchema } from "@/modules/staff";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  auth: { audience: "admin", permission: "users.manage" },
  handle: async ({ resolve }) => {
    const rows = await resolve(ListStaffToken).execute();
    return reply.ok(rows, { total: rows.length });
  },
});

/** POST — invite a panel user; returns the one-time invitation link (shown once to the admin). */
export const POST = route({
  auth: { audience: "admin", permission: "users.manage" },
  body: staffInviteSchema,
  cacheControl: "no-store",
  handle: async (ctx) => reply.created(await ctx.resolve(InviteStaffToken).execute(ctx.body, actorOf(ctx))),
});
