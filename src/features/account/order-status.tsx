import { orderStatusMeta } from "@/lib/order-rules";

const TONE: Record<string, string> = {
  green: "bg-green-50 text-green-700", blue: "bg-blue-50 text-blue-700", amber: "bg-amber-50 text-amber-800", red: "bg-red-50 text-red-700",
  purple: "bg-violet-50 text-violet-700", slate: "bg-slate-100 text-slate-700",
};

/** Order status pill in the storefront palette (labels shared with the panel: src/lib/order-rules.ts). */
export function OrderStatusPill({ status }: { status: string }) {
  const m = orderStatusMeta(status);
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[m.tone] ?? TONE.slate}`}>{m.label}</span>;
}
