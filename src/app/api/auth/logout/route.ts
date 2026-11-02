import { LogoutToken } from "@/modules/identity";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** Backward-compatible storefront logout endpoint. Prefer /api/storefront/auth/logout for new calls. */
export const POST = route({
  handle: async ({ resolve }) => {
    await resolve(LogoutToken).execute("storefront");
    return { loggedOut: true };
  },
});
