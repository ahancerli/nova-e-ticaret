import { NotFoundError } from "@/core";
import { z } from "zod";
import { COUNTRY_CODE, GeoDirectoryToken } from "@/modules/geo";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

/** GET /api/geo/countries/:code/regions — provinces with their districts ([] = free text city / region). */
export const GET = route({
  params: z.object({ code: z.string().regex(COUNTRY_CODE) }),
  cacheControl: "public, max-age=3600",
  handle: async ({ params, resolve }) => {
    const regions = await resolve(GeoDirectoryToken).regions(params.code);
    if (!regions) throw new NotFoundError("country_not_found", "Ülke bulunamadı.");
    return regions;
  },
});
