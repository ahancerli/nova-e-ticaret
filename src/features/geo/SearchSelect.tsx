"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { flagSrc, foldTr } from "@/modules/geo/domain/geo";

export interface SelectOption {
  value: string;
  label: string;
  /** Right-aligned secondary text (dial code); also searchable. */
  hint?: string;
  /** ISO country code → flag. */
  flag?: string;
}

export function Flag({ code, className = "" }: { code: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- 245 tiny static SVGs, next/image adds nothing here
  return <img src={flagSrc(code)} alt="" width={20} height={15} loading="lazy" className={`h-[15px] w-5 flex-none rounded-[3px] object-cover ring-1 ring-ink/10 ${className}`} />;
}

/**
 * Picker with a search box: the list filters as you type (Turkish-aware: "turk" finds "Türkiye", "istanbul" finds
 * "İstanbul"), arrows / Enter / Escape work, the chosen row is scrolled into view on open. `compact` renders the
 * trigger as the dial-code segment of the phone field.
 */
export function SearchSelect({
  id, label, options, value, onChange, placeholder = "Seçin", searchPlaceholder = "Ara", empty = "Sonuç yok", error, disabled, compact, describedBy,
}: {
  id: string;
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  empty?: string;
  error?: string;
  disabled?: boolean;
  compact?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value) ?? null;

  const shown = useMemo(() => {
    const q = foldTr(query);
    if (!q) return options;
    const hit = options.filter((o) => foldTr(`${o.label} ${o.hint ?? ""} ${o.value}`).includes(q));
    // names that start with the query first ("al" → Almanya before Kanada)
    return [...hit.filter((o) => foldTr(o.label).startsWith(q)), ...hit.filter((o) => !foldTr(o.label).startsWith(q))];
  }, [options, query]);

  const show = (q = "") => {
    if (disabled) return;
    setQuery(q);
    setActive(q ? 0 : Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const close = (refocus = true) => { setOpen(false); if (refocus) button.current?.focus(); };
  const pick = (o: SelectOption | undefined) => { if (!o) return; onChange(o.value); close(); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = shown.length;
      if (n) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(shown[active]);
    } else if (e.key === "Escape") {
      // closes only the list, not a dialog around the form
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <div ref={root} className={`relative ${compact ? "flex-none" : ""}`}>
      <button
        ref={button} id={id} type="button" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-label={compact ? `${label}: ${selected ? `${selected.label} ${selected.hint ?? ""}` : placeholder}` : undefined}
        aria-describedby={describedBy}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); show(); }
          else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) show(e.key);
        }}
        className={compact
          ? "flex h-full items-center gap-1.5 rounded-l-[9px] pr-2 pl-3 text-sm font-medium tabular-nums hover:bg-ground focus-visible:bg-ground focus-visible:outline-none disabled:opacity-60"
          : `input flex items-center gap-2 text-left disabled:bg-ground disabled:text-muted ${open ? "border-brand" : error ? "border-danger" : ""}`}
      >
        {selected?.flag && <Flag code={selected.flag} />}
        {compact
          ? <span>{selected?.hint ?? "+"}</span>
          : <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-muted"}`}>{selected?.label ?? placeholder}</span>}
        <ChevronDown aria-hidden className={`size-4 flex-none text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className={`absolute top-[calc(100%+6px)] left-0 z-40 overflow-hidden rounded-xl border border-line bg-white shadow-[0_12px_32px_-12px_rgb(25_22_64/0.35)] ${compact ? "w-[min(20rem,calc(100vw-2rem))]" : "w-full min-w-60"}`}>
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search aria-hidden className="size-4 flex-none text-muted" />
            <input
              autoFocus role="combobox" aria-expanded aria-controls={listId} aria-autocomplete="list" aria-label={`${label} ara`}
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              value={query} placeholder={searchPlaceholder} onKeyDown={onKey}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
          </div>
          <ul ref={list} id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto overscroll-contain py-1">
            {shown.length === 0 && <li className="px-3 py-3 text-sm text-muted">{empty}</li>}
            {shown.map((o, i) => (
              <li
                key={o.value} id={`${listId}-${i}`} data-i={i} role="option" aria-selected={o.value === value}
                onPointerMove={() => setActive(i)} onClick={() => pick(o)}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm ${i === active ? "bg-ground" : ""} ${o.value === value ? "font-semibold" : ""}`}
              >
                {o.flag && <Flag code={o.flag} />}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-xs text-muted tabular-nums">{o.hint}</span>}
                <Check aria-hidden className={`size-4 flex-none text-brand ${o.value === value ? "" : "invisible"}`} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
