"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { CornerDownLeft, Search } from "lucide-react";
import { useDialogFocus, usePresence } from "@/lib/motion";
import { Portal } from "@/components/ui/Portal";

export type PaletteItem = { id: string; label: string; group: string; href: string; icon: ComponentType<{ className?: string }>; keywords?: string; external?: boolean };

const norm = (s: string) => s.toLocaleLowerCase("tr-TR").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

/** ⌘K / Ctrl+K command palette: jump to any module or run a quick action. */
export function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const presence = usePresence(open);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  useDialogFocus(panelRef, open && presence.mounted, onClose);

  const results = useMemo(() => {
    const q = norm(query.trim());
    return q ? items.filter((i) => norm(`${i.label} ${i.group} ${i.keywords ?? ""}`).includes(q)) : items;
  }, [items, query]);
  const groups = useMemo(() => [...new Set(results.map((r) => r.group))], [results]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    if (item.external) window.open(item.href, "_blank", "noopener");
    else router.push(item.href);
  };

  if (!presence.mounted) return null;
  let index = -1;

  return (
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-start justify-center px-3 pt-[12vh]" role="presentation">
        <button type="button" tabIndex={-1} aria-label="Kapat" data-state={presence.state} onClick={onClose}
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-[3px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Komut paleti" data-state={presence.state} onAnimationEnd={presence.onAnimationEnd}
          className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_80px_-20px_rgb(15_23_42/0.5)] data-[state=closed]:animate-scale-out data-[state=open]:animate-scale-in">
          <div className="flex items-center gap-3 border-b border-slate-200 px-4">
            <Search className="h-5 w-5 flex-none text-slate-400" />
            <input
              data-autofocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); run(results[cursor]); }
              }}
              placeholder="Modül, sayfa veya işlem ara…"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={results[cursor] ? `palette-${results[cursor]!.id}` : undefined}
              className="h-14 flex-1 bg-transparent text-[15px] text-slate-800 outline-none placeholder:text-slate-400"
            />
            <kbd className="hidden rounded-md border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-400 sm:block">ESC</kbd>
          </div>
          <ul id="palette-list" ref={listRef} role="listbox" className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
            {results.length === 0 ? <li className="px-3 py-10 text-center text-sm text-slate-500">“{query}” için sonuç yok.</li> : null}
            {groups.map((g) => (
              <li key={g} role="presentation">
                <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{g}</p>
                <ul role="presentation">
                  {results.filter((r) => r.group === g).map((r) => {
                    index += 1;
                    const i = index;
                    const on = i === cursor;
                    const Icon = r.icon;
                    return (
                      <li key={r.id} id={`palette-${r.id}`} role="option" aria-selected={on} data-index={i}
                        onMouseMove={() => setCursor(i)} onClick={() => run(r)}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${on ? "bg-indigo-50 text-[#5b4fe0]" : "text-slate-700"}`}>
                        <span className={`grid size-8 flex-none place-items-center rounded-lg ${on ? "bg-white text-[#7367f0] shadow-sm" : "bg-slate-100 text-slate-500"}`}><Icon className="h-4 w-4" /></span>
                        <span className="flex-1 truncate font-medium">{r.label}</span>
                        {on ? <CornerDownLeft className="h-4 w-4 flex-none text-[#7367f0]" /> : null}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-4 border-t border-slate-200 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-400">
            <span><kbd className="font-sans">↑↓</kbd> gezin</span><span><kbd className="font-sans">↵</kbd> aç</span><span><kbd className="font-sans">esc</kbd> kapat</span>
          </div>
        </div>
      </div>
    </Portal>
  );
}
