import "server-only";
import { CartLocatorToken, CartRepositoryToken } from "@/modules/cart";
import { resolveService } from "../app";

/** Legacy facade over the cart module for checkout (not yet migrated). New code resolves cart use cases. */
export type { CartRef } from "@/modules/cart";

export async function resolveCart(opts: { create: boolean }) {
  return (await resolveService(CartLocatorToken)).locate(opts);
}

export async function cartCouponCode(cartId: string): Promise<string | null> {
  return (await resolveService(CartRepositoryToken)).couponCode(cartId);
}
