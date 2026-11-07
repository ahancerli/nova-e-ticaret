import { UpdateNotificationStateToken, notificationReadSchema, viewerOf } from "@/modules/notifications";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST `{ all: true }` or `{ ids, read }` — read state of the caller only. */
export const POST = route({
  auth: { audience: "admin" },
  body: notificationReadSchema,
  handle: async ({ body, resolve, user }) => {
    const svc = resolve(UpdateNotificationStateToken);
    if ("all" in body) await svc.markRead(viewerOf(user), "all", true);
    else await svc.markRead(viewerOf(user), body.ids, body.read);
    return { updated: true };
  },
});
