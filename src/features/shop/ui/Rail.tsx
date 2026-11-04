"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronIcon } from "@/components/icons";

/**
 * Horizontal scroller with prev/next buttons (desktop) and touch scrolling (mobile). Items are server-rendered
 * children; this island only moves the scroll position. `itemClass` sets how many fit per breakpoint.
 */
export function Rail({ label, children, itemClass = "w-[46%] sm:w-[31%] md:w-[23%] lg:w-[18.6%]" }: {
  label: string; children: React.ReactNode[]; itemClass?: string;
}) {
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { el.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);

  const move = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.9, behavior: "smooth" });
  const btn = "absolute top-1/2 z-10 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-line bg-white text-ink shadow-md transition hover:text-brand disabled:pointer-events-none disabled:opacity-0 md:grid";

  return (
    <div className="relative">
      <ul ref={ref} aria-label={label} className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1">
        {children.map((c, i) => <li key={i} className={`flex-none snap-start ${itemClass}`}>{c}</li>)}
      </ul>
      <button type="button" className={`${btn} -left-4`} onClick={() => move(-1)} disabled={edge.start} aria-label={`${label}: önceki`}><ChevronIcon dir="left" /></button>
      <button type="button" className={`${btn} -right-4`} onClick={() => move(1)} disabled={edge.end} aria-label={`${label}: sonraki`}><ChevronIcon /></button>
    </div>
  );
}
