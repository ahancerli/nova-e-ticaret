"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellRing, TrendingDown } from "lucide-react";
import { ClientApiError } from "@/lib/api-client";
import { notify } from "@/lib/toast";
import type { AlertKind, ProductAlertState } from "@/modules/alerts/domain/alert";
import { alertsApi } from "../data/alerts-api";

const key = (variantId: string, kind: AlertKind) => `${variantId}:${kind}`;

/**
 * The signed-in customer's open alerts on this product, keyed by variant + kind, and a toggle. Guests get a sign-in
 * prompt that brings them back to the product.
 */
export function useProductAlerts(productId: string, slug: string, signedIn: boolean) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    alertsApi.forProduct(productId).then((rows: ProductAlertState[]) => {
      if (live) setAlerts(Object.fromEntries(rows.map((r) => [key(r.variantId, r.kind), r.alertId])));
    }, () => {});
    return () => { live = false; };
  }, [productId, signedIn]);

  const toggle = useCallback(async (variantId: string, kind: AlertKind) => {
    const k = key(variantId, kind);
    if (!signedIn) {
      notify.info("Haber vermemiz için giriş yapın", { action: { label: "Giriş yap", onClick: () => router.push(`/giris?next=${encodeURIComponent(`/urun/${slug}`)}`) } });
      return;
    }
    setBusy(k);
    try {
      const current = alerts[k];
      if (current) {
        await alertsApi.cancel(current);
        setAlerts((a) => Object.fromEntries(Object.entries(a).filter(([x]) => x !== k)));
        notify.success(kind === "back_in_stock" ? "Stok takibi kapatıldı" : "Fiyat takibi kapatıldı");
      } else {
        const r = await alertsApi.subscribe(variantId, kind);
        setAlerts((a) => ({ ...a, [k]: r.alertId }));
        notify.success(kind === "back_in_stock" ? "Stok gelince haber vereceğiz" : "Fiyat düşünce haber vereceğiz", { description: "E-posta adresinize bir kez bildirim göndereceğiz." });
      }
    } catch (err) {
      if (err instanceof ClientApiError && err.isUnauthorized) router.push(`/giris?next=${encodeURIComponent(`/urun/${slug}`)}`);
      else notify.error(err);
    } finally {
      setBusy(null);
    }
  }, [alerts, router, signedIn, slug]);

  return {
    isOn: (variantId: string, kind: AlertKind) => Boolean(alerts[key(variantId, kind)]),
    isBusy: (variantId: string, kind: AlertKind) => busy === key(variantId, kind),
    toggle,
  };
}

type Alerts = ReturnType<typeof useProductAlerts>;

/** Takes the place of "Sepete ekle" while the picked variant is sold out. */
export function StockAlertButton({ variantId, alerts }: { variantId: string; alerts: Alerts }) {
  const on = alerts.isOn(variantId, "back_in_stock");
  return (
    <button type="button" aria-pressed={on} disabled={alerts.isBusy(variantId, "back_in_stock")} onClick={() => alerts.toggle(variantId, "back_in_stock")}
      className={`btn h-12 flex-1 gap-2 rounded-full text-base transition ${on ? "border-2 border-ink bg-white text-ink hover:bg-ground" : "bg-ink text-white hover:bg-ink/90"} disabled:animate-pulse`}>
      {on ? <BellRing className="size-5" aria-hidden /> : <Bell className="size-5" aria-hidden />}
      {on ? "Stok gelince haber vereceğiz" : "Stok gelince haber ver"}
    </button>
  );
}

/** Secondary action next to "Karşılaştır". */
export function PriceAlertButton({ variantId, alerts }: { variantId: string; alerts: Alerts }) {
  const on = alerts.isOn(variantId, "price_drop");
  return (
    <button type="button" aria-pressed={on} disabled={alerts.isBusy(variantId, "price_drop")} onClick={() => alerts.toggle(variantId, "price_drop")}
      className={`inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold transition ${on ? "border-brand bg-brand-soft text-brand-dark" : "border-line bg-white hover:border-ink-soft"} disabled:animate-pulse`}>
      <TrendingDown className="size-4" aria-hidden /> {on ? "Fiyat takibinde" : "Fiyat düşünce haber ver"}
    </button>
  );
}
