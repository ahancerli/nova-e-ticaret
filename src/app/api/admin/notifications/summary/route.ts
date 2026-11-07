import { GetNotificationSummaryToken, viewerOf } from "@/modules/notifications";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET — unread count + latest notifications for the bell (polled by the admin shell). */
export const GET = route({
  auth: { audience: "admin" },
  handle: ({ resolve, user }) => resolve(GetNotificationSummaryToken).execute(viewerOf(user)),
});
