import { AlertCircle } from "lucide-react";
import type { FormState } from "./form-state";

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------
export type SectionProps = { form: FormState; patch: (p: Partial<FormState>) => void; fe: (k: string) => string | undefined };
export const labelCls = "mb-1 block text-xs font-medium text-slate-600";
export const inputCls = "input border-slate-200 text-sm text-slate-800 aria-[invalid=true]:border-red-400 aria-[invalid=true]:bg-red-50/40";
export const Req = () => <span className="text-red-500" aria-hidden> *</span>;

export function SectionShell({ title, desc, required, actions, children }: { title: string; desc?: string; required?: boolean; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}{required ? <Req /> : null}</h2>
          {desc ? <p className="mt-0.5 text-sm text-slate-500">{desc}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Field({ id, label, required, error, hint, className = "", children }: { id: string; label: string; required?: boolean; error?: string; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={labelCls}>{label}{required ? <Req /> : null}</label>
      {children}
      {error ? <p className="mt-1 flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3 w-3 flex-none" />{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Counter({ value, max }: { value: string; max: number }) {
  return <span className={`tabular-nums ${value.length > max ? "text-red-600" : ""}`}>{value.length}/{max}</span>;
}
