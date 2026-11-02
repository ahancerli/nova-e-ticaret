import { GetHomeToken } from "@/modules/storefront";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** Middle area of the home page is fetched client-side (spec R02). */
export const GET = route({
  handle: ({ resolve }) => resolve(GetHomeToken).execute(),
});
