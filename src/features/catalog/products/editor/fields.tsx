import type { FormState } from "./form-state";
import { Req } from "@/components/admin/form";

export { Counter, Field, Req, inputCls, labelCls } from "@/components/admin/form";

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------
export type SectionProps = { form: FormState; patch: (p: Partial<FormState>) => void; fe: (k: string) => string | undefined };

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

