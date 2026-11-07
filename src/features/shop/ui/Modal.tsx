"use client";

import { useRef, type ReactNode } from "react";
import { useDialogFocus, usePresence } from "@/lib/motion";
import { Portal } from "@/components/ui/Portal";
import { CloseIcon } from "@/components/icons";

/**
 * Storefront dialog: bottom sheet on phones, centred card from `sm`. Focus trapped, Escape / backdrop close,
 * focus returns to the trigger.
 */
export function Modal({ open, onClose, title, children, size = "md", labelledBy = "shop-modal-title" }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; size?: "sm" | "md" | "lg"; labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const presence = usePresence(open);
  useDialogFocus(ref, open && presence.mounted, onClose);
  if (!presence.mounted) return null;
  const width = size === "sm" ? "sm:max-w-md" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg";
  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4" role="presentation">
        <button type="button" aria-label="Kapat" tabIndex={-1} data-state={presence.state} onClick={onClose}
          className="absolute inset-0 bg-ink/45 backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} data-state={presence.state} onAnimationEnd={presence.onAnimationEnd}
          className={`relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in sm:rounded-3xl sm:data-[state=closed]:animate-scale-out sm:data-[state=open]:animate-scale-in ${width}`}>
          <header className="flex items-center gap-3 border-b border-line px-5 py-4">
            <h2 id={labelledBy} className="flex-1 text-lg font-bold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Kapat" className="grid size-10 place-items-center rounded-full text-ink-soft transition hover:rotate-90 hover:bg-ground"><CloseIcon /></button>
          </header>
          <div className="overflow-y-auto overscroll-contain px-5 py-5">{children}</div>
        </div>
      </div>
    </Portal>
  );
}
