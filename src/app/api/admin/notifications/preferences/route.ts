import { NotificationPreferencesToken, notificationPreferencesSchema, viewerOf } from "@/modules/notifications";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** The caller's muted notification types. */
export const GET = route({
  auth: { audience: "admin" },
  handle: ({ resolve, user }) => resolve(NotificationPreferencesToken).get(viewerOf(user).userId),
});

export const PUT = route({
  auth: { audience: "admin" },
  body: notificationPreferencesSchema,
  handle: async ({ body, resolve, user }) => {
    const svc = resolve(NotificationPreferencesToken);
    await svc.set(viewerOf(user).userId, body.muted);
    return svc.get(viewerOf(user).userId);
  },
});
