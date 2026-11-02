"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ClientApiError } from "@/lib/api-client";
import type { Quote } from "@/lib/types";

const EMPTY: Quote = { currency: "TRY", lines: [], adjustments: [], couponCode: null, subtotalMinor: 0, discountMinor: 0, shippingMinor: 0, taxMinor: 0, totalMinor: 0, itemCount: 0, warnings: [] };

interface CartCtx {
  cart: Quote;
  version: number;
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api<Quote>("/api/cart");
      setCart(r.data);
      setVersion(Number(r.meta.version ?? 0));
    } catch {
      /* header still renders with 0 */
    }
  }, []);

  useEffect(() => {
    // Initial load after hydration; the shell itself is server-rendered and cart-agnostic (cache-safe).
    let cancelled = false;
    api<Quote>("/api/cart").then(
      (r) => {
        if (cancelled) return;
        setCart(r.data);
        setVersion(Number(r.meta.version ?? 0));
      },
      () => { /* header still renders with 0 */ },
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
      setError(e instanceof ClientApiError ? e.message : "Bir hata oluştu.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo<CartCtx>(
    () => ({
      cart, version, open, busy, error, setOpen, refresh,
      add: async (variantId, quantity = 1) => {
        const okk = await run(() => api<Quote>("/api/cart/items", { method: "POST", json: { variantId, quantity } }));
        if (okk) setOpen(true); // spec: no redirect, open right drawer
        return okk;
      },
      update: async (itemId, quantity) => {
        await run(() => api<Quote>(`/api/cart/items/${encodeURIComponent(itemId)}`, { method: "PATCH", json: { quantity } }));
      },
      remove: async (itemId) => {
        await run(() => api<Quote>(`/api/cart/items/${encodeURIComponent(itemId)}`, { method: "DELETE" }));
      },
      applyCoupon: (code) => run(() => api<Quote>("/api/cart/coupons", { method: "POST", json: { code } })),
      removeCoupon: async () => {
        await run(() => api<Quote>("/api/cart/coupons", { method: "DELETE" }));
      },
    }),
    [cart, version, open, busy, error, refresh, run],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be used inside <CartProvider>");
  return c;
}
