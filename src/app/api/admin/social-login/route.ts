import { GetSocialLoginSettingsToken } from "@/modules/social-login";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/admin/social-login — every provider of the catalogue with its settings; client secrets are never returned. */
export const GET = route({
  auth: { audience: "admin", permission: "settings.write" },
  handle: ({ resolve }) => resolve(GetSocialLoginSettingsToken).execute(),
});
