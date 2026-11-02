import { ArrowDownRight, ArrowUpRight, Minus, Sparkles } from "lucide-react";
import type { Kpi } from "@/modules/reporting";
import { changeTone, formatChange } from "./format";

const TONE = {
  good: "bg-emerald-50 text-emerald-700",
  bad: "bg-rose-50 text-rose-700",
  flat: "bg-slate-100 text-slate-600",
  new: "bg-slate-100 text-slate-600",
} as const;

/**
 * Stat tile: label · value · change against the previous period (colour = direction × whether up is good,
 * always with an arrow and a sign so it never relies on colour) · optional sparkline of the period.
 */
export function KpiTile({ label, value, kpi, compareLabel, upIsGood = true, trend, hint }: {
  label: string;
  value: string;
  kpi: Kpi;
  compareLabel: string;
  upIsGood?: boolean;
  trend?: number[];
  hint?: string;
}) {
  const tone = changeTone(kpi, upIsGood);
  const Icon = tone === "new" ? Sparkles : tone === "flat" ? Minus : (kpi.change ?? 0) > 0 ? ArrowUpRight : ArrowDownRight;
  const text = tone === "new" ? "Yeni" : formatChange(kpi.change ?? 0);

  return (
    <div className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[tone]}`} title={compareLabel}>
          <Icon className="size-3.5" aria-hidden />
          {text}
        </span>
      </div>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-[28px] font-semibold leading-none tracking-tight text-slate-900">{value}</p>
          <p className="mt-2 text-xs text-slate-500">{hint ?? compareLabel}</p>
        </div>
        {trend && trend.length > 1 ? <Sparkline values={trend} /> : null}
      </div>
      <span className="sr-only">{`${label}: ${value}, ${compareLabel} ${text}`}</span>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 96, h = 32, pad = 4;
  const max = Math.max(...values, 1);
  const step = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1]!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden>
      <polygon points={`${pad},${h - pad} ${line} ${lx},${h - pad}`} fill="#7367f0" fillOpacity={0.1} />
      <polyline points={line} fill="none" stroke="#7367f0" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={4} fill="#7367f0" stroke="#fff" strokeWidth={2} />
    </svg>
  );
}
