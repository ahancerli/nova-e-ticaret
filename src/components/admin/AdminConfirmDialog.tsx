"use client";

import { useRef } from "react";
import { TriangleAlert } from "lucide-react";
import { useDialogFocus, usePresence } from "@/lib/motion";
import { Portal } from "@/components/ui/Portal";

/** Animated confirm dialog (replaces window.confirm). Cancel gets initial focus so Enter never destroys data by accident. */
export function AdminConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Onayla",
  busyLabel = "İşleniyor…",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  busyLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const presence = usePresence(open);
  useDialogFocus(panelRef, open && presence.mounted, busy ? () => {} : onCancel);

  if (!presence.mounted) return null;
  const confirmCls = tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-[#7367f0] hover:bg-[#6559df]";

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] grid place-items-end p-4 sm:place-items-center" role="presentation">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Vazgeç"
          data-state={presence.state}
          onClick={busy ? undefined : onCancel}
          className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
        />
        <div
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby={description ? "confirm-desc" : undefined}
          data-state={presence.state}
          onAnimationEnd={presence.onAnimationEnd}
          className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl data-[state=closed]:animate-scale-out data-[state=open]:animate-scale-in sm:p-6"
        >
          <div className="flex gap-4">
            <span className={`grid size-10 flex-none place-items-center rounded-full ${tone === "danger" ? "bg-red-50 text-red-600" : "bg-indigo-50 text-[#7367f0]"}`}>
              <TriangleAlert className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 id="confirm-title" className="text-base font-semibold text-slate-900">{title}</h2>
              {description ? <p id="confirm-desc" className="mt-1 text-sm text-slate-500">{description}</p> : null}
            </div>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" data-autofocus onClick={onCancel} disabled={busy}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
              Vazgeç
            </button>
            <button type="button" onClick={onConfirm} disabled={busy}
              className={`inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white transition disabled:opacity-60 ${confirmCls}`}>
              {busy ? busyLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
