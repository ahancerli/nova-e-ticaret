"use client";

import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useDialogFocus, usePresence } from "@/lib/motion";
import { Portal } from "@/components/ui/Portal";

/**
 * Right-side sheet for admin edit forms. Slides in from the right, slides out on close.
 * Full-screen on phones, fixed width from `sm` up. Focus trapped, Escape closes, focus returns to the trigger.
 */
export function AdminDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const presence = usePresence(open);
  useDialogFocus(panelRef, open && presence.mounted, onClose);

  if (!presence.mounted) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-50" role="presentation">
        <button
          type="button"
          aria-label="Paneli kapat"
          tabIndex={-1}
          data-state={presence.state}
          onClick={onClose}
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-drawer-title"
          data-state={presence.state}
          onAnimationEnd={presence.onAnimationEnd}
          className="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-[-24px_0_60px_-20px_rgb(15_23_42/0.35)] will-change-transform data-[state=closed]:animate-slide-out-right data-[state=open]:animate-slide-in-right sm:max-w-xl sm:rounded-l-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <h2 id="admin-drawer-title" className="truncate text-lg font-semibold text-slate-900">{title}</h2>
              {subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}
            </div>
            <button type="button" onClick={onClose} aria-label="Kapat" className="inline-flex size-9 flex-none items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
          {footer ? <div className="border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}
