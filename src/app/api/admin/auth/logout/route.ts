import { LogoutToken } from "@/modules/identity";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const POST = route({
  handle: async ({ resolve }) => {
    await resolve(LogoutToken).execute("admin");
    return { loggedOut: true, audience: "admin" };
  },
});
