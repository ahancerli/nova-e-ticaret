"use client";

import { useEffect, useRef } from "react";
import { toAmount, type CommerceEvent, type TrackItem } from "@/modules/consent/domain/events";
import type { Quote, QuoteLine } from "@/lib/types";
import { track } from "./track";

/** Cart / checkout line → tracking item (unit price after line discounts, TL). */
export const lineItem = (l: QuoteLine, quantity = l.quantity): TrackItem => ({
  id: l.sku || l.productId, name: l.productName, variant: l.variantLabel || null,
  price: toAmount(l.quantity ? Math.round(l.totalMinor / l.quantity) : l.unitPriceMinor), quantity,
});

export const quoteItems = (q: Quote) => q.lines.map((l) => lineItem(l));

const PENDING_PURCHASE = "nova:pending-purchase";

/**
 * Card payments leave the site (iyzico) before the order is paid, so the purchase is reported on the result page:
 * checkout stores the order's lines here, the result page sends it once for that order number.
 */
export function rememberPurchase(orderNumber: string, q: Quote) {
  const event: CommerceEvent = {
    name: "purchase", transactionId: orderNumber, items: quoteItems(q), value: toAmount(q.totalMinor), shipping: toAmount(q.shippingMinor),
    tax: toAmount(q.taxMinor), coupon: q.couponCode,
  };
  try { sessionStorage.setItem(PENDING_PURCHASE, JSON.stringify(event)); } catch { /* private mode: no purchase event */ }
}

/** Result page island: sends the remembered purchase for `orderNumber` exactly once (reloads send nothing). */
export function TrackPurchase({ orderNumber }: { orderNumber: string }) {
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PENDING_PURCHASE);
      const event = raw ? (JSON.parse(raw) as CommerceEvent) : null;
      if (event?.name !== "purchase" || event.transactionId !== orderNumber) return;
      sessionStorage.removeItem(PENDING_PURCHASE);
      track(event);
    } catch { /* ignore */ }
  }, [orderNumber]);
  return null;
}

/** SSR pages (product detail, search): one event per distinct `id` while mounted. */
export function TrackEvent({ id, event }: { id: string; event: CommerceEvent }) {
  const sent = useRef<string | null>(null);
  const latest = useRef(event);
  useEffect(() => { latest.current = event; });
  useEffect(() => {
    if (sent.current === id) return;
    sent.current = id;
    track(latest.current);
  }, [id]);
  return null;
}
