import { GetMailSettingsToken, RemoveMailSettingsToken, SaveMailSettingsToken, mailSettingsDeleteSchema, mailSettingsSchema } from "@/modules/mail";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/integrations/mail — SMTP settings (`null` when none); the password is never returned. */
export const GET = route({
  auth: { audience: "admin", permission: "integrations.write" },
  handle: ({ resolve }) => resolve(GetMailSettingsToken).execute(),
});

/** PUT — save SMTP settings; empty password keeps the stored one. `expectedUpdatedAt` guards concurrent edits (409). */
export const PUT = route({
  auth: { audience: "admin", permission: "integrations.write" },
  body: mailSettingsSchema,
  handle: (ctx) => ctx.resolve(SaveMailSettingsToken).execute(ctx.body, actorOf(ctx)),
});

export const DELETE = route({
  auth: { audience: "admin", permission: "integrations.write" },
  body: mailSettingsDeleteSchema,
  handle: async (ctx) => {
    await ctx.resolve(RemoveMailSettingsToken).execute(ctx.body.expectedUpdatedAt, actorOf(ctx));
    return { removed: true };
  },
});
