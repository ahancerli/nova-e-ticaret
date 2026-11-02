"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { notify } from "@/lib/toast";
import type { OrderDetail } from "@/modules/orders";

export function Card({ title, subtitle, icon: Icon, actions, children }: { title: string; subtitle?: string; icon: ComponentType<{ className?: string }>; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-slate-100 text-slate-500"><Icon className="h-4 w-4" /></span>
          <div className="leading-tight">
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
          </div>
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><dt className="min-w-0 text-slate-500">{label}</dt><dd className="flex-none text-right tabular-nums text-slate-700">{value}</dd></div>;
}

export function Alert({ tone, icon: Icon, title, action, children }: { tone: "amber" | "red"; icon: ComponentType<{ className?: string }>; title: string; action?: ReactNode; children: ReactNode }) {
  const c = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-900";
  return (
    <div className={`flex animate-fade-in flex-col gap-3 rounded-2xl border px-4 py-3.5 sm:flex-row sm:items-center ${c}`} role="status">
      <Icon className="h-5 w-5 flex-none" />
      <div className="min-w-0 flex-1 text-sm"><p className="font-semibold">{title}</p><p className="mt-0.5 opacity-90">{children}</p></div>
      {action}
    </div>
  );
}

export function Empty({ icon: Icon, text, action }: { icon: ComponentType<{ className?: string }>; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-slate-100 text-slate-400"><Icon className="h-5 w-5" /></span>
      <p className="text-sm text-slate-500">{text}</p>
      {action}
    </div>
  );
}

export function ShipProgress({ shipped, total }: { shipped: number; total: number }) {
  if (!shipped) return <span className="text-slate-400">Gönderilmedi</span>;
  const full = shipped >= total;
  return (
    <span className={`inline-flex items-center gap-1.5 ${full ? "text-emerald-600" : "text-blue-600"}`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-200"><span className={`block h-full rounded-full ${full ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${(shipped / total) * 100}%` }} /></span>
      {shipped}/{total} gönderildi
    </span>
  );
}

export function Address({ title, a, same }: { title: string; a: OrderDetail["shippingAddress"]; same?: boolean }) {
  return (
    <div className="space-y-1 px-5 py-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      {!a ? <p className="text-slate-500">Adres yok.</p> : same && title === "Fatura" ? <p className="text-slate-500">Teslimat adresiyle aynı.</p> : (
        <>
          <p className="font-medium text-slate-800">{a.recipientName}</p>
          <p className="text-slate-600">{a.line1}{a.line2 ? `, ${a.line2}` : ""}</p>
          <p className="text-slate-600">{a.district} / {a.province}{a.postalCode ? ` · ${a.postalCode}` : ""}</p>
          {a.phone ? <p className="text-slate-500">{a.phone}</p> : null}
          {a.companyName ? <p className="text-slate-500">{a.companyName}{a.taxOffice ? ` · ${a.taxOffice}` : ""}</p> : null}
        </>
      )}
    </div>
  );
}

export function Contact({ icon: Icon, value, copy }: { icon: ComponentType<{ className?: string }>; value: string; copy: boolean }) {
  return (
    <p className="flex items-center gap-2 text-slate-600">
      <Icon className="h-3.5 w-3.5 flex-none text-slate-400" />
      <span className="min-w-0 flex-1 truncate">{value}</span>
      {copy ? <CopyButton value={value} label="Kopyala" /> : null}
    </p>
  );
}

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={label} title={label}
      onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { notify.error("Panoya kopyalanamadı."); } }}
      className="grid size-7 flex-none place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
      {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function NoteField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-600">Not</span>
      <textarea rows={2} maxLength={500} className="input min-h-16 border-slate-200 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}
