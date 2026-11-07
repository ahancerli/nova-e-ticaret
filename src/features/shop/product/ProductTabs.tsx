"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type ProductTab = { id: string; label: string; count?: number | null; content: ReactNode };

/**
 * Product detail tabs (açıklama / özellikler / değerlendirmeler). Every panel is server-rendered and stays in the
 * HTML (inactive ones `hidden`), so crawlers still read the description and reviews. The URL hash selects a tab
 * (`#degerlendirmeler` from the rating link, shared links); arrow / Home / End keys follow the WAI-ARIA tabs pattern.
 */
export function ProductTabs({ tabs, initial }: { tabs: ProductTab[]; initial?: string }) {
  const [active, setActive] = useState(() => tabs.find((t) => t.id === initial)?.id ?? tabs[0]?.id);
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const fromHash = (scroll: boolean) => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!tabs.some((t) => t.id === id)) return;
      setActive(id);
      if (scroll) requestAnimationFrame(() => root.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    fromHash(true);
    if (initial && initial === active) requestAnimationFrame(() => root.current?.scrollIntoView({ block: "start" }));
    const onHash = () => fromHash(true);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: hash + deep link (`initial`)
  }, []);

  const select = (id: string, focus = false) => {
    setActive(id);
    window.history.replaceState(null, "", `#${id}`);
    if (focus) buttons.current[tabs.findIndex((t) => t.id === id)]?.focus();
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(tabs[(next + tabs.length) % tabs.length]!.id, true);
  };

  return (
    <div ref={root} className="mt-12 scroll-mt-28">
      <div role="tablist" aria-label="Ürün bilgileri" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t, i) => {
          const on = t.id === active;
          return (
            <button
              key={t.id} ref={(el) => { buttons.current[i] = el; }} type="button" role="tab" id={`tab-${t.id}`}
              aria-selected={on} aria-controls={`panel-${t.id}`} tabIndex={on ? 0 : -1}
              onClick={() => select(t.id)} onKeyDown={(e) => onKey(e, i)}
              className={`-mb-px flex flex-none items-center gap-2 border-b-[3px] px-4 py-3 text-sm font-semibold whitespace-nowrap transition md:px-6 md:text-base ${
                on ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
              {t.count != null && (
                <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${on ? "bg-brand-soft text-brand-dark" : "bg-ground text-muted"}`}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} hidden={t.id !== active} tabIndex={0} className="pt-6 focus:outline-none">
          {t.content}
        </div>
      ))}
    </div>
  );
}
