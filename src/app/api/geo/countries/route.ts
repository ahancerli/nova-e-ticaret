import { GeoDirectoryToken } from "@/modules/geo";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/geo/countries — selectable countries with flag code and mobile number rules (reference data). */
export const GET = route({
  cacheControl: "public, max-age=3600",
  handle: ({ resolve }) => resolve(GeoDirectoryToken).countries(),
});
