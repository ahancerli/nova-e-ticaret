import { UpdateNotificationStateToken, notificationArchiveSchema, viewerOf } from "@/modules/notifications";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** POST `{ ids, archived }` — move to / back from the caller's archive. */
export const POST = route({
  auth: { audience: "admin" },
  body: notificationArchiveSchema,
  handle: async ({ body, resolve, user }) => {
    await resolve(UpdateNotificationStateToken).archive(viewerOf(user), body.ids, body.archived);
    return { updated: true };
  },
});
