import { GetAdminSettingsToken } from "@/modules/settings";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/settings — every registry setting with its value (+ image URLs, per-group change times). */
export const GET = route({
  auth: { audience: "admin", permission: "settings.write" },
  handle: ({ resolve }) => resolve(GetAdminSettingsToken).execute(),
});
