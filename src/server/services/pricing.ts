import "server-only";
import type { Quote } from "@/lib/types";
import { BuildQuoteToken } from "@/modules/pricing";
import { resolveService } from "../app";

/** Legacy facade over the pricing module for checkout (not yet migrated). */
export async function buildQuote(cartId: string, couponCode: string | null): Promise<Quote> {
  return (await resolveService(BuildQuoteToken)).execute(cartId, couponCode);
}
