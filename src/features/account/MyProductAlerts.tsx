"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, TrendingDown } from "lucide-react";
import { formatMinor } from "@/lib/money";
import { notify } from "@/lib/toast";
import type { MyProductAlert } from "@/modules/alerts/domain/alert";
import { alertsApi } from "@/features/shop/data/alerts-api";

const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", timeZone: "Europe/Istanbul" });

/** What the row says now: waiting, already true (mail on its way), or mailed. */
function statusOf(a: MyProductAlert): { label: string; tone: string } {
  if (a.status === "notified") return { label: `${day.format(new Date(a.notifiedAt ?? a.createdAt))} tarihinde haber verildi`, tone: "bg-ground text-ink-soft" };
  if (a.kind === "back_in_stock") return a.available > 0 ? { label: "Stokta, e-postanız yolda", tone: "bg-green-50 text-success" } : { label: "Stok bekleniyor", tone: "bg-amber-50 text-amber-700" };
  const dropped = a.currentPriceMinor != null && a.baselinePriceMinor != null && a.currentPriceMinor < a.baselinePriceMinor;
  return dropped ? { label: "Fiyatı düştü", tone: "bg-green-50 text-success" } : { label: "Fiyat takipte", tone: "bg-amber-50 text-amber-700" };
}

/** Hesabım › Haber ver listem: open stock / price alerts (removable) and the ones already mailed. */
export function MyProductAlerts({ initial }: { initial: MyProductAlert[] }) {
  const [alerts, setAlerts] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  const cancel = async (a: MyProductAlert) => {
    setBusy(a.id);
    try {
      await alertsApi.cancel(a.id);
      setAlerts((list) => list.filter((x) => x.id !== a.id));
      notify.success("Haber ver talebi kaldırıldı");
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="haber-ver" className="card scroll-mt-24 p-5" aria-labelledby="my-alerts-title">
      <h2 id="my-alerts-title" className="mb-1 text-lg font-semibold">Haber ver listem</h2>
      <p className="mb-4 text-sm text-ink-soft">Tükenen bir ürün yeniden stoğa girdiğinde ya da takip ettiğiniz ürünün fiyatı düştüğünde size bir kez e-posta göndeririz.</p>
      {alerts.length === 0 ? (
        <p className="rounded-xl bg-ground px-5 py-8 text-center text-sm text-ink-soft">
          Henüz takip ettiğiniz ürün yok. Ürün sayfasındaki <b>Stok gelince haber ver</b> veya <b>Fiyat düşünce haber ver</b> düğmesini kullanın.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {alerts.map((a) => {
            const s = statusOf(a);
            const Icon = a.kind === "back_in_stock" ? Bell : TrendingDown;
            return (
              <li key={a.id} className="flex items-center gap-3 py-3.5 first:pt-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- uploaded / demo asset */}
                <img src={a.imageUrl ?? "/demo/placeholder.svg"} alt="" className="size-14 flex-none rounded-xl border border-line bg-white object-contain p-1" />
                <div className="min-w-0 flex-1">
                  <Link href={`/urun/${a.productSlug}`} className="block truncate font-semibold hover:text-brand">{a.productName}</Link>
                  {a.variantLabel ? <p className="truncate text-xs text-muted">{a.variantLabel}</p> : null}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 font-medium text-ink-soft"><Icon className="size-3.5" aria-hidden />{a.kind === "back_in_stock" ? "Stok" : "Fiyat"}</span>
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${s.tone}`}>{s.label}</span>
                  </div>
                </div>
                <div className="flex flex-none flex-col items-end gap-1">
                  {a.currentPriceMinor != null ? (
                    <span className="text-sm tabular-nums">
                      {a.kind === "price_drop" && a.baselinePriceMinor != null && a.baselinePriceMinor !== a.currentPriceMinor
                        ? <><span className="mr-1 text-xs text-muted line-through">{formatMinor(a.baselinePriceMinor)}</span><b>{formatMinor(a.currentPriceMinor)}</b></>
                        : <b>{formatMinor(a.currentPriceMinor)}</b>}
                    </span>
                  ) : null}
                  {a.status === "active" ? (
                    <button type="button" disabled={busy === a.id} onClick={() => cancel(a)} className="text-xs font-semibold text-ink-soft underline-offset-2 hover:text-danger hover:underline disabled:opacity-50">
                      Kaldır
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
