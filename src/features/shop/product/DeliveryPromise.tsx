"use client";

import { useSyncExternalStore } from "react";
import { Truck } from "lucide-react";
import { deliveryPromise, durationLabel, type DeliveryRules } from "@/modules/delivery/domain/delivery";

const TICK = 30_000;
const subscribe = (l: () => void) => { const t = setInterval(l, TICK); return () => clearInterval(t); };
const minuteNow = () => Math.floor(Date.now() / TICK) * TICK;

/**
 * "Bugün sipariş verirsen yarın kargoda": shipping day + delivery window from the shop's rules. The server renders it
 * for the request time (`serverNow`); in the browser it follows the clock, so the countdown and the day roll over live.
 */
export function DeliveryPromise({ rules, serverNow }: { rules: DeliveryRules; serverNow: string }) {
  const now = useSyncExternalStore(subscribe, minuteNow, () => Date.parse(serverNow));
  const p = deliveryPromise(rules, new Date(now));
  if (!p) return null;
  const ship = p.shipLabel.charAt(0).toLocaleUpperCase("tr-TR") + p.shipLabel.slice(1);
  const lead = p.orderWithinMinutes != null ? `${durationLabel(p.orderWithinMinutes)} içinde sipariş verirsen` : "Şimdi sipariş verirsen";
  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl border border-line px-4 py-3" aria-live="polite">
      <span className="mt-0.5 grid size-9 flex-none place-items-center rounded-full bg-[var(--dept,var(--color-brand))] text-white"><Truck className="size-[18px]" aria-hidden /></span>
      <p className="text-sm leading-snug text-ink-soft">
        {lead} <strong className="font-bold text-ink">{p.shipLabel === "bugün" || p.shipLabel === "yarın" ? p.shipLabel : ship} kargoda</strong>
        <span className="mt-0.5 block">Tahmini teslim <time dateTime={p.deliveryFrom} className="font-semibold text-ink">{p.deliveryLabel}</time></span>
      </p>
    </div>
  );
}
