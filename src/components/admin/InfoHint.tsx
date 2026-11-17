"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Info } from "lucide-react";

/**
 * Small "i" button that explains the thing beside it in one or two plain sentences. Opens on click or keyboard
 * focus + Enter, closes on outside click / Escape. Use it wherever a term, a setting or a number needs a reason.
 *   <InfoHint title="Taban fiyat">Kampanyalar ürünü bu fiyatın altına indiremez.</InfoHint>
 */
export function InfoHint({ title, children, href, hrefLabel = "Kılavuzda aç", align = "start", className = "" }: {
  title?: string;
  children: ReactNode;
  /** Optional "read more" target (usually a user guide anchor). */
  href?: string;
  hrefLabel?: string;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const id = useId();

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
    <span ref={rootRef} className={`relative inline-flex align-middle ${className}`}>
      <button ref={btnRef} type="button" aria-label={title ? `${title} hakkında bilgi` : "Bilgi"} aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="grid size-6 place-items-center rounded-full text-slate-400 transition-colors hover:bg-indigo-50 hover:text-[#7367f0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7367f0] aria-expanded:bg-indigo-50 aria-expanded:text-[#7367f0]">
        <Info className="h-4 w-4" />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.span id={id} role="note"
            initial={{ opacity: 0, y: -4, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 520, damping: 34 }}
            className={`absolute top-[calc(100%+8px)] z-50 block w-72 max-w-[80vw] rounded-xl bg-[#191640] p-3.5 text-left text-[13px] font-normal leading-5 text-indigo-50 shadow-[0_16px_40px_-12px_rgb(25_22_64/0.55)] ${align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left"}`}>
            {title ? <span className="mb-1 block text-sm font-semibold text-white">{title}</span> : null}
            <span className="block">{children}</span>
            {href ? <Link href={href} onClick={() => setOpen(false)} className="mt-2 inline-block font-medium text-[#b3adff] underline underline-offset-2 hover:text-white">{hrefLabel}</Link> : null}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
