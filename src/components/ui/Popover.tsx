"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePresence } from "@/lib/motion";

/**
 * Anchored menu / panel (user menu, quick-create, notifications…).
 * Grows from its trigger, closes on outside click, Escape (focus returns to the trigger) or via `close()`.
 */
export function Popover({
  label,
  button,
  buttonClassName,
  align = "end",
  panelClassName = "w-64",
  children,
}: {
  label: string;
  button: ReactNode;
  buttonClassName: string;
  align?: "start" | "end";
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const presence = usePresence(open);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button ref={btnRef} type="button" aria-label={label} aria-haspopup="true" aria-expanded={open} aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)} className={buttonClassName}>
        {button}
      </button>
      {presence.mounted ? (
        <div id={panelId} data-state={presence.state} onAnimationEnd={presence.onAnimationEnd}
          className={`absolute top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_16px_48px_-12px_rgb(15_23_42/0.28)] data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in ${
            align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left"
          } ${panelClassName}`}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}
