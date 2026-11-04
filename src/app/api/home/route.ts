import { GetHomeToken } from "@/modules/storefront";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** Home sections as JSON for API clients; the storefront itself renders them on the server (features/shop). */
export const GET = route({
  handle: ({ resolve }) => resolve(GetHomeToken).execute(),
});
