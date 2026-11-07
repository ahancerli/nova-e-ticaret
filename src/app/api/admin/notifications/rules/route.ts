import { GetNotificationRulesToken, UpdateNotificationRulesToken, notificationRulesSchema } from "@/modules/notifications";
import { actorOf } from "@/modules/shared/actor";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** Shop-wide rules per notification type: shown in the panel, e-mailed to fixed recipients. */
export const GET = route({
  auth: { audience: "admin", permission: "settings.write" },
  handle: ({ resolve }) => resolve(GetNotificationRulesToken).execute(),
});

export const PUT = route({
  auth: { audience: "admin", permission: "settings.write" },
  body: notificationRulesSchema,
  handle: async (ctx) => {
    await ctx.resolve(UpdateNotificationRulesToken).execute(ctx.body.rules, actorOf(ctx));
    return ctx.resolve(GetNotificationRulesToken).execute();
  },
});
