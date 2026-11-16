"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ClientApiError } from "@/lib/api-client";
import { notify } from "@/lib/toast";
import { wishlistApi } from "../data/wishlist-api";

export const WISHLIST_HREF = "/hesabim?sekme=favoriler";

interface WishlistContext {
  signedIn: boolean;
  count: number;
  has: (productId: string) => boolean;
  toggle: (product: { id: string; name: string }) => void;
}

const Ctx = createContext<WishlistContext | null>(null);

/**
 * Hearts of the whole shop. The layout passes the signed-in customer's saved ids (one query), so cards render filled
 * hearts without a request; toggles are optimistic and roll back on error. Keyed by user in the layout → a sign-in /
 * sign-out starts from the server's list again. Guests get a sign-in prompt that brings them back.
 */
export function WishlistProvider({ signedIn, initialIds, children }: { signedIn: boolean; initialIds: string[]; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ids, setIds] = useState(() => new Set(initialIds));
  // one request per product at a time; a second click while it runs is ignored
  const pending = useRef(new Set<string>());

  const set = (productId: string, on: boolean) => setIds((s) => {
    if (s.has(productId) === on) return s;
    const next = new Set(s);
    if (on) next.add(productId); else next.delete(productId);
    return next;
  });

  const signIn = useCallback(() => router.push(`/giris?next=${encodeURIComponent(pathname)}`), [pathname, router]);
  const latestToggle = useRef<((product: { id: string; name: string }, wantOn?: boolean) => Promise<void>) | null>(null);

  const toggle = useCallback(async (product: { id: string; name: string }, wantOn?: boolean) => {
    if (!signedIn) {
      notify.info("Favorilere eklemek için giriş yapın", { description: "Beğendiklerin hesabında saklanır, her cihazdan görürsün.", action: { label: "Giriş yap", onClick: signIn } });
      return;
    }
    if (pending.current.has(product.id)) return;
    const on = wantOn ?? !ids.has(product.id);
    pending.current.add(product.id);
    set(product.id, on);
    try {
      const r = on ? await wishlistApi.add(product.id) : await wishlistApi.remove(product.id);
      set(product.id, r.saved);
      if (on) notify.success("Favorilere eklendi", { id: `wl-${product.id}`, description: product.name, action: { label: "Favorilerim", onClick: () => router.push(WISHLIST_HREF) } });
      // The toast outlives this render: undo calls the latest toggle through the ref, not this closure.
      else notify.success("Favorilerden çıkarıldı", { id: `wl-${product.id}`, description: product.name, action: { label: "Geri al", onClick: () => void latestToggle.current?.(product, true) } });
    } catch (err) {
      set(product.id, !on);
      if (err instanceof ClientApiError && err.isUnauthorized) signIn();
      else notify.error(err);
    } finally {
      pending.current.delete(product.id);
    }
  }, [ids, router, signIn, signedIn]);
  useEffect(() => { latestToggle.current = toggle; }, [toggle]);

  const value = useMemo<WishlistContext>(() => ({
    signedIn, count: ids.size, has: (id) => ids.has(id), toggle: (p) => void toggle(p),
  }), [ids, signedIn, toggle]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Outside the provider (e.g. an isolated preview) hearts stay empty and inert. */
const NONE: WishlistContext = { signedIn: false, count: 0, has: () => false, toggle: () => {} };

export const useWishlist = () => useContext(Ctx) ?? NONE;
