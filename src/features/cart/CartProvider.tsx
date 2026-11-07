"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/api-client";
import { cartApi } from "./api";
import type { Quote } from "@/lib/types";

const EMPTY: Quote = { currency: "TRY", lines: [], adjustments: [], promotions: [], couponCode: null, subtotalMinor: 0, discountMinor: 0, shippingMinor: 0, taxMinor: 0, totalMinor: 0, itemCount: 0, warnings: [] };

interface CartCtx {
  cart: Quote;
  version: number;
  /** false until the first GET /api/cart answered (avoids an "empty cart" flash on the cart page). */
  ready: boolean;
  /** Variant added by the last successful add() — the drawer greets and highlights it; cleared on close. */
  lastAdded: string | null;
  open: boolean;
  busy: boolean;
  error: string | null;
  setOpen: (v: boolean) => void;
  refresh: () => Promise<void>;
  add: (variantId: string, quantity?: number) => Promise<boolean>;
  update: (itemId: string, quantity: number) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
  applyCoupon: (code: string) => Promise<boolean>;
  removeCoupon: () => Promise<void>;
}

const Ctx = createContext<CartCtx | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<Quote>(EMPTY);
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [open, setOpenState] = useState(false);
  const setOpen = useCallback((v: boolean) => { setOpenState(v); if (!v) setLastAdded(null); }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await cartApi.get();
      setCart(r.data);
      setVersion(Number(r.meta.version ?? 0));
    } catch {
      /* header still renders with 0 */
    }
  }, []);

  useEffect(() => {
    // Initial load after hydration; the shell itself is server-rendered and cart-agnostic (cache-safe).
    let cancelled = false;
    cartApi.get().then(
      (r) => {
        if (cancelled) return;
        setCart(r.data);
        setVersion(Number(r.meta.version ?? 0));
        setReady(true);
      },
      () => { if (!cancelled) setReady(true); /* header still renders with 0 */ },
    );
    return () => { cancelled = true; };
  }, []);

  const run = useCallback(async (fn: () => Promise<{ data: Quote }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setCart(r.data);
      setVersion((v) => v + 1);
      return true;
    } catch (e) {
      setError(errorMessage(e, "Bir hata oluştu."));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo<CartCtx>(
    () => ({
      cart, version, ready, lastAdded, open, busy, error, setOpen, refresh,
      add: async (variantId, quantity = 1) => {
        const added = await run(() => cartApi.add(variantId, quantity));
        if (added) { setLastAdded(variantId); setOpenState(true); } // spec: no redirect, open right drawer
        return added;
      },
      update: async (itemId, quantity) => {
        await run(() => cartApi.update(itemId, quantity));
      },
      remove: async (itemId) => {
        await run(() => cartApi.remove(itemId));
      },
      applyCoupon: (code) => run(() => cartApi.applyCoupon(code)),
      removeCoupon: async () => {
        await run(() => cartApi.removeCoupon());
      },
    }),
    [cart, version, ready, lastAdded, open, busy, error, setOpen, refresh, run],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be used inside <CartProvider>");
  return c;
}
