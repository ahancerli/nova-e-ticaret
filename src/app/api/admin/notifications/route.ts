import { reply } from "@/core";
import { ListNotificationsToken, notificationQuerySchema, viewerOf } from "@/modules/notifications";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/notifications — the caller's notifications (filter tab, type, paging); meta.unread for the tab badge. */
export const GET = route({
  auth: { audience: "admin" },
  query: notificationQuerySchema,
  handle: async ({ query, resolve, user }) => {
    const r = await resolve(ListNotificationsToken).execute(viewerOf(user), query);
    return reply.ok(r.rows, { total: r.total, unread: r.unread, page: query.page, pageSize: query.pageSize });
  },
});
