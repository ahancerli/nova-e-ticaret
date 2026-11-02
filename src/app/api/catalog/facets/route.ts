import { GetFacetsToken, parseListQuery } from "@/modules/storefront";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  handle: ({ req, resolve }) => resolve(GetFacetsToken).execute(parseListQuery(new URL(req.url).searchParams)),
});
