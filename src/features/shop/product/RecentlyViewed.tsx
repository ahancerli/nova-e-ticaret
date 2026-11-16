"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ProductCard as Card } from "@/lib/types";
import { notify } from "@/lib/toast";
import { getConsentSnapshot, getServerConsentSnapshot, subscribeConsent } from "../../consent/consent-store";
import { recentApi } from "../data/recent-api";
import { ProductCard } from "../ui/ProductCard";
import { Rail } from "../ui/Rail";

/**
 * Son gezilenler rail. On a product page (`productId`) it records the view and shows the others; elsewhere (home
 * section) it only reads. The server keeps nothing without functional cookie consent, so the rail simply stays
 * hidden then; it asks again when the visitor changes their cookie choice.
 */
export function RecentlyViewed({ productId, title = "Son gezdiğin ürünler", subtitle, limit, className = "mt-12", innerClassName }: {
  productId?: string; title?: string; subtitle?: string | null; limit?: number;
  /** `className` styles the section (e.g. a home band), `innerClassName` its content box. */
  className?: string; innerClassName?: string;
}) {
  const functional = useSyncExternalStore(subscribeConsent, () => getConsentSnapshot().choices.functional, () => getServerConsentSnapshot().choices.functional);
  const [items, setItems] = useState<Card[]>([]);

  useEffect(() => {
    let live = true;
    (productId ? recentApi.record(productId) : recentApi.list(limit)).then(
      (r) => { if (live) setItems(limit ? r.slice(0, limit) : r); },
      () => { /* a missing rail is not worth an error message */ },
    );
    return () => { live = false; };
  }, [productId, limit, functional]);

  if (!items.length) return null;

  const clear = async () => {
    const before = items;
    setItems([]);
    try {
      await recentApi.clear();
      notify.success("Gezdiğin ürünler listesi temizlendi");
    } catch (err) {
      setItems(before);
      notify.error(err, { fallback: "Liste temizlenemedi." });
    }
  };

  return (
    <section className={className} aria-labelledby="recently-viewed-title">
      <div className={innerClassName}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h2 id="recently-viewed-title" className="font-display text-[22px] font-extrabold tracking-[-0.02em] md:text-[28px]">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-ink-soft">{subtitle}</p> : null}
        </div>
        <button type="button" onClick={() => void clear()} className="text-sm font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline">Geçmişi temizle</button>
      </div>
      <Rail label={title}>{items.map((p) => <ProductCard key={p.id} p={p} />)}</Rail>
      </div>
    </section>
  );
}
