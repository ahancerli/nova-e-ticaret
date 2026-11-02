"use client";

import { useEffect, useEffectEvent, useState, useSyncExternalStore, type AnimationEvent, type RefObject } from "react";

const noopSubscribe = () => () => {};

/** true only after hydration — gate portals to document.body with it (no hydration mismatch). */
export function useIsClient() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * Keeps an overlay mounted until its exit animation has finished.
 *
 *   const p = usePresence(open);
 *   if (!p.mounted) return null;
 *   <div data-state={p.state} onAnimationEnd={p.onAnimationEnd} className="data-[state=open]:animate-x data-[state=closed]:animate-y" />
 *
 * Only animationend events fired by the element itself count (children may animate too).
 */
export function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setMounted(true);
  }
  const onAnimationEnd = (e: AnimationEvent<HTMLElement>) => {
    if (e.target === e.currentTarget && !open) setMounted(false);
  };
  return { mounted, state: open ? ("open" as const) : ("closed" as const), onAnimationEnd };
}

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

// Stacked modals (e.g. a confirm dialog over a drawer): only the top-most one handles keys.
const dialogStack: symbol[] = [];

/**
 * Modal focus contract (spec §08): focus moves inside on open, Tab is trapped,
 * Escape closes, focus returns to the trigger, page scroll is locked.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void) {
  // Latest onClose without re-running the effect (callers often pass inline functions).
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!active) return;
    const self = Symbol("dialog");
    dialogStack.push(self);
    const returnTo = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    (panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== self) return;
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0], last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialogStack.splice(dialogStack.indexOf(self), 1);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      returnTo?.focus?.();
    };
  }, [ref, active]);
}
