import { UnitOfWork, type Clock, type Database, type IdGenerator } from "@/core";
import type { ProductCard } from "@/lib/types";
import type { Actor } from "@/modules/shared/actor";
import { WishlistErrors } from "../domain/errors";
import { MAX_WISHLIST_ITEMS, type WishlistChange } from "../domain/wishlist";
import type { WishlistCards, WishlistRepository } from "./ports";

export interface WishlistDeps {
  db: Database;
  wishlist: WishlistRepository;
  clock: Clock;
  ids: IdGenerator;
}

/** Heart on a card / product page: adds a published product (idempotent; a product already on the list is a no-op). */
export class AddToWishlist {
  constructor(private readonly deps: WishlistDeps) {}

  async execute(productId: string, actor: Actor): Promise<WishlistChange> {
    const { wishlist } = this.deps;
    if (!(await wishlist.isPublished(productId))) throw WishlistErrors.productNotFound();
    const saved = await wishlist.productIds(actor.userId);
    if (saved.includes(productId)) return { productId, saved: true, count: saved.length };
    if (saved.length >= MAX_WISHLIST_ITEMS) throw WishlistErrors.full();
    await new UnitOfWork(this.deps.db)
      .add(...wishlist.addStatements({ listId: this.deps.ids.newId(), userId: actor.userId, productId, now: this.deps.clock.nowIso() }))
      .commit();
    return { productId, saved: true, count: await wishlist.count(actor.userId) };
  }
}

/** Removes a product (idempotent: removing what is not there answers the same; also works for unpublished products). */
export class RemoveFromWishlist {
  constructor(private readonly deps: WishlistDeps) {}

  async execute(productId: string, actor: Actor): Promise<WishlistChange> {
    await new UnitOfWork(this.deps.db).add(this.deps.wishlist.removeStatement(actor.userId, productId)).commit();
    return { productId, saved: false, count: await this.deps.wishlist.count(actor.userId) };
  }
}

/** Storefront shell: which products wear a filled heart (all saved ids, published or not). */
export class GetWishlistProductIds {
  constructor(private readonly wishlist: WishlistRepository) {}

  execute(userId: string): Promise<string[]> {
    return this.wishlist.productIds(userId);
  }
}

/** Hesabım › Favorilerim: cards of the saved products still on sale, last added first; `unavailable` = the rest. */
export class ListMyWishlist {
  constructor(private readonly wishlist: WishlistRepository, private readonly cards: WishlistCards) {}

  async execute(userId: string): Promise<{ items: ProductCard[]; unavailable: number }> {
    const ids = await this.wishlist.productIds(userId);
    const items = await this.cards.execute(ids);
    return { items, unavailable: ids.length - items.length };
  }
}
