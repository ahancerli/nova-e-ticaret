import type { Statement } from "@/core";

export interface CartRepository {
  findMemberCart(userId: string): Promise<{ id: string; version: number } | null>;
  findGuestCart(tokenHash: string, now: string): Promise<{ id: string; version: number } | null>;
  createMemberCart(id: string, userId: string): Promise<void>;
  createGuestCart(id: string, tokenHash: string, expiresAt: string): Promise<void>;

  /** null when the variant does not exist. */
  sellability(variantId: string): Promise<{ sellable: boolean; available: number } | null>;
  quantityInCart(cartId: string, variantId: string): Promise<number>;
  /** Variant of a line, only if the line belongs to `cartId` (ownership check). */
  lineVariant(cartId: string, itemId: string): Promise<string | null>;
  couponCode(cartId: string): Promise<string | null>;

  /** Adds `quantity` to the line (relative, so concurrent adds both count), never above `cap`. */
  addQuantityStatement(cartId: string, variantId: string, quantity: number, cap: number, itemId: string, now: string): Statement;
  setQuantityStatement(cartId: string, itemId: string, quantity: number, now: string): Statement;
  deleteLineStatement(cartId: string, itemId: string): Statement;
  /** version + 1; with `expectedVersion` it only matches that version (guard it, changes = 1). */
  bumpVersionStatement(cartId: string, now: string, expectedVersion?: number): Statement;
  replaceCouponStatements(cartId: string, couponId: string | null): Statement[];
  /** Moves guest lines into the member cart (quantities summed, capped by stock and MAX_LINE_QTY). */
  mergeStatements(guestCartId: string, memberCartId: string, now: string): Statement[];
}
