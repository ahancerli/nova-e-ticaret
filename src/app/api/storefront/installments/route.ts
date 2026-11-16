import { z } from "zod";
import { GetInstallmentOptionsToken } from "@/modules/payments";
import { route } from "@/server/app";

export const dynamic = "force-dynamic";

const query = z.object({ price: z.coerce.number().int().min(100, "Tutar çok düşük.").max(100_000_000) });

/** GET `?price=<kuruş>` — "Taksit seçenekleri" table of an amount (iyzico installment inquiry, cached 6 h). */
export const GET = route({
  query,
  rateLimit: { name: "installments", limit: 120, windowSec: 60 },
  cacheControl: "public, max-age=1800",
  handle: (ctx) => ctx.resolve(GetInstallmentOptionsToken).execute(ctx.query.price),
});
