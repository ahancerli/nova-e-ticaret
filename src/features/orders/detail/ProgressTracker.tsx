import { Check, XCircle } from "lucide-react";
import { ORDER_FLOW, type OrderStatus } from "@/lib/order-rules";

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
export function ProgressTracker({ status }: { status: OrderStatus }) {
  const cancelled = status === "cancelled";
  const reachedIdx = ORDER_FLOW.reduce((acc, s, i) => (s.reached.includes(status) ? i : acc), -1);
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white px-4 py-5 shadow-sm sm:px-6">
      <ol className="flex min-w-140 items-center">
        {ORDER_FLOW.map((s, i) => {
          const done = !cancelled && i <= reachedIdx;
          const current = !cancelled && i === reachedIdx + 1;
          return (
            <li key={s.key} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-2">
                <span className={`grid size-9 place-items-center rounded-full text-xs font-bold transition-colors duration-500 ${
                  done ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30" : current ? "bg-white text-[#7367f0] ring-2 ring-[#7367f0]" : cancelled && i === 0 ? "bg-red-500 text-white" : "bg-slate-100 text-slate-400"
                }`}>
                  {done ? <Check className="h-4 w-4" /> : cancelled && i === 0 ? <XCircle className="h-4 w-4" /> : i + 1}
                </span>
                <span className={`whitespace-nowrap text-xs ${done ? "font-semibold text-slate-800" : current ? "font-semibold text-[#5b4fe0]" : "text-slate-400"}`}>
                  {cancelled && i === 0 ? "İptal edildi" : s.label}
                </span>
              </div>
              {i < ORDER_FLOW.length - 1 ? (
                <span className="mx-2 mb-6 h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span className={`block h-full rounded-full bg-emerald-500 transition-[width] duration-700 ease-out-expo ${!cancelled && i < reachedIdx ? "w-full" : "w-0"}`} />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
