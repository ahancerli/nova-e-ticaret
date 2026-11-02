"use client";

import { useRef, type ComponentType, type ReactNode } from "react";
import { X } from "lucide-react";
import { useDialogFocus, usePresence } from "@/lib/motion";
import { Portal } from "@/components/ui/Portal";

/**
 * Small modal with a form (action dialogs: approve payment, cancel with reason, add note…).
 * Same motion + focus contract as every overlay; Enter submits, Escape cancels (unless busy).
 */
export function AdminFormDialog({
  open,
  title,
  description,
  icon: Icon,
  tone = "primary",
  submitLabel,
  cancelLabel = "Vazgeç",
  busyLabel = "İşleniyor…",
  busy = false,
  submitDisabled = false,
  onSubmit,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: "primary" | "danger" | "success";
  submitLabel: string;
  cancelLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  submitDisabled?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const panelRef = useRef<HTMLFormElement>(null);
  const presence = usePresence(open);
  useDialogFocus(panelRef, open && presence.mounted, busy ? () => {} : onCancel);
  if (!presence.mounted) return null;

  const tones = {
    primary: { chip: "bg-indigo-50 text-[#7367f0]", btn: "bg-[#7367f0] hover:bg-[#6559df] shadow-[#7367f0]/30" },
    danger: { chip: "bg-red-50 text-red-600", btn: "bg-red-600 hover:bg-red-700 shadow-red-600/20" },
    success: { chip: "bg-emerald-50 text-emerald-600", btn: "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20" },
  }[tone];

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] grid place-items-end p-0 sm:place-items-center sm:p-4" role="presentation">
        <button type="button" tabIndex={-1} aria-label="Kapat" data-state={presence.state} onClick={busy ? undefined : onCancel}
          className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <form
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="form-dialog-title"
          data-state={presence.state}
          onAnimationEnd={presence.onAnimationEnd}
          onSubmit={(e) => { e.preventDefault(); if (!busy && !submitDisabled) onSubmit(); }}
          className="relative w-full max-w-lg rounded-t-2xl bg-white shadow-2xl data-[state=closed]:animate-scale-out data-[state=open]:animate-scale-in sm:rounded-2xl"
        >
          <div className="flex items-start gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
            {Icon ? <span className={`grid size-10 flex-none place-items-center rounded-full ${tones.chip}`}><Icon className="h-5 w-5" /></span> : null}
            <div className="min-w-0 flex-1">
              <h2 id="form-dialog-title" className="text-base font-semibold text-slate-900">{title}</h2>
              {description ? <div className="mt-1 text-sm text-slate-500">{description}</div> : null}
            </div>
            <button type="button" onClick={onCancel} disabled={busy} aria-label="Kapat" className="-mr-1 -mt-1 grid size-8 flex-none place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          {children ? <div className="space-y-4 px-5 pt-4 sm:px-6">{children}</div> : null}
          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button type="button" onClick={onCancel} disabled={busy} className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
              {cancelLabel}
            </button>
            <button type="submit" disabled={busy || submitDisabled} className={`inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition disabled:opacity-60 ${tones.btn}`}>
              {busy ? busyLabel : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </Portal>
  );
}
