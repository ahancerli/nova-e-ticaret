import { z } from "zod";
import { NotFoundError } from "@/core";
import { GetProductDetailToken } from "@/modules/storefront";
import { slugInput } from "@/modules/shared/schemas";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

export const GET = route({
  params: z.object({ slug: slugInput }),
  handle: async ({ params, resolve }) => {
    const product = await resolve(GetProductDetailToken).execute(params.slug);
    if (!product) throw new NotFoundError("not_found", "Ürün bulunamadı.");
    return product;
  },
});
