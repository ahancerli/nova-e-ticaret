"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Dashboard } from "@/modules/reporting";
import { bucketLabel, formatCount, formatTry, formatTryCompact } from "./format";

type Point = Dashboard["series"][number];
type Metric = "revenue" | "orders";

const METRICS: { key: Metric; label: string }[] = [
  { key: "revenue", label: "Ciro" },
  { key: "orders", label: "Sipariş" },
];
const ACCENT = "#7367f0";
const HEIGHT = 260;
const M = { top: 12, right: 8, bottom: 28, left: 56 };

/** Rounds the axis maximum up to 1 / 2 / 2.5 / 5 × 10ⁿ so ticks are clean numbers. */
function niceMax(v: number): number {
  if (v <= 0) return 4;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

/**
 * Sales over the period, one measure at a time (no dual axis): columns with a hover / keyboard tooltip and a
 * table view of the same numbers. Revenue is collected money; "Sipariş" counts every order placed.
 */
export function SalesChart({ series, bucket }: { series: Point[]; bucket: Dashboard["period"]["bucket"] }) {
  const [metric, setMetric] = useState<Metric>("revenue");
  const [active, setActive] = useState<number | null>(null);
  const [width, setWidth] = useState(720);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const value = (p: Point) => (metric === "revenue" ? p.revenueMinor : p.orders);
  const fmtAxis = metric === "revenue" ? formatTryCompact : formatCount;
  // Order counts need whole-number ticks: at least 4 so four steps stay integers.
  const max = metric === "orders" ? Math.max(4, Math.ceil(niceMax(Math.max(...series.map(value))) / 4) * 4) : niceMax(Math.max(...series.map(value)));
  const empty = series.every((p) => value(p) === 0);
  // An empty period gets only the baseline tick — five "₺0" labels would read as data.
  const ticks = empty ? [0] : [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);

  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;
  const slot = plotW / Math.max(series.length, 1);
  const barW = Math.max(2, Math.min(24, slot - 2));
  const y = (v: number) => M.top + plotH - (v / max) * plotH;
  const labelEvery = Math.max(1, Math.ceil(series.length / Math.max(2, Math.floor(plotW / 72))));
  const total = series.reduce((a, p) => a + value(p), 0);
  const hovered = active === null ? null : series[active];

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const last = series.length - 1;
    setActive((i) => (i === null ? last : Math.min(last, Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1)))));
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Satış grafiği</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {metric === "revenue" ? "Tahsil edilen tutar" : "Verilen sipariş adedi"}, {bucket === "hour" ? "saatlik" : "günlük"} · toplam{" "}
            <span className="font-semibold text-slate-700">{metric === "revenue" ? formatTry(total) : formatCount(total)}</span>
          </p>
        </div>
        <div role="radiogroup" aria-label="Gösterilen ölçü" className="inline-flex rounded-lg bg-slate-100 p-0.5">
          {METRICS.map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={metric === m.key} onClick={() => setMetric(m.key)}
              className={`h-8 rounded-md px-3 text-sm font-medium transition ${metric === m.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={box} className="relative px-2 pt-2" onPointerLeave={() => setActive(null)}>
        {/* One tab stop for the whole chart; ← / → walk the columns (90 stops would be a keyboard trap). */}
        <svg width={width} height={HEIGHT} role="img" tabIndex={0} onKeyDown={onKey} onBlur={() => setActive(null)}
          aria-label={`${metric === "revenue" ? "Ciro" : "Sipariş"} grafiği. Sütunlar arasında sol ve sağ ok tuşlarıyla gezinin; değerler aşağıdaki tabloda.`}
          className="block max-w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#7367f0]/40">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[11px] tabular-nums">{fmtAxis(t)}</text>
            </g>
          ))}
          {series.map((p, i) => {
            const v = value(p);
            const cx = M.left + slot * i + slot / 2;
            const top = y(v);
            const h = M.top + plotH - top;
            const r = Math.min(4, barW / 2, h);
            const x0 = cx - barW / 2;
            return (
              <g key={p.bucket}>
                {h > 0 ? (
                  // Rounded data end, square at the baseline.
                  <path
                    d={`M${x0},${top + h} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${top + h} Z`}
                    fill={ACCENT} fillOpacity={active === null || active === i ? 1 : 0.35}
                  />
                ) : null}
                {i % labelEvery === 0 ? (
                  <text x={cx} y={HEIGHT - 8} textAnchor="middle" className="fill-slate-400 text-[11px]">{bucketLabel(p.bucket)}</text>
                ) : null}
                {/* Hit target: the whole column slot, bigger than the bar. */}
                <rect x={M.left + slot * i} y={M.top} width={slot} height={plotH} fill="transparent" onPointerEnter={() => setActive(i)} />
              </g>
            );
          })}
          <line x1={M.left} x2={width - M.right} y1={M.top + plotH} y2={M.top + plotH} stroke="#cbd5e1" strokeWidth={1} />
        </svg>

        {empty ? (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-slate-400">Bu dönemde {metric === "revenue" ? "tahsilat" : "sipariş"} yok.</p>
        ) : null}

        {hovered && active !== null && !empty ? (
          <div role="status" className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
            style={{ left: Math.min(Math.max(8, M.left + slot * active + slot / 2 - 80), width - 168) }}>
            <p className="font-medium text-slate-500">{bucketLabel(hovered.bucket, true)}</p>
            <p className="mt-1 flex items-center justify-between gap-4">
              <span className="text-slate-500">Ciro</span><strong className="text-sm text-slate-900">{formatTry(hovered.revenueMinor)}</strong>
            </p>
            <p className="flex items-center justify-between gap-4">
              <span className="text-slate-500">Sipariş</span><strong className="text-sm text-slate-900">{formatCount(hovered.orders)}</strong>
            </p>
          </div>
        ) : null}
      </div>

      <details className="group border-t border-slate-100 px-5 py-3 text-sm">
        <summary className="cursor-pointer select-none text-xs font-medium text-slate-500 hover:text-slate-700">Tablo olarak göster</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white text-left text-slate-500">
              <tr><th className="py-1.5 font-medium">{bucket === "hour" ? "Saat" : "Gün"}</th><th className="py-1.5 text-right font-medium">Ciro</th><th className="py-1.5 text-right font-medium">Sipariş</th></tr>
            </thead>
            <tbody className="tabular-nums text-slate-700">
              {series.map((p) => (
                <tr key={p.bucket} className="border-t border-slate-100">
                  <td className="py-1.5">{bucketLabel(p.bucket, true)}</td>
                  <td className="py-1.5 text-right">{formatTry(p.revenueMinor)}</td>
                  <td className="py-1.5 text-right">{formatCount(p.orders)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
