"use client";

import { useSyncExternalStore } from "react";

/**
 * Comparison list of this browser (no login, no server state): up to COMPARE_LIMIT products in localStorage,
 * synced across tabs through the `storage` event. The page itself is addressed by slugs (/karsilastir?urunler=a,b),
 * so a comparison link can be shared.
 */
export interface CompareItem {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
}

export const COMPARE_LIMIT = 4;
const KEY = "nova:compare";
const EMPTY: CompareItem[] = [];
const listeners = new Set<() => void>();
let cache: CompareItem[] | null = null;

function read(): CompareItem[] {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    cache = Array.isArray(parsed)
      ? parsed.filter((x): x is CompareItem => !!x && typeof x === "object" && typeof (x as CompareItem).slug === "string" && typeof (x as CompareItem).id === "string").slice(0, COMPARE_LIMIT)
      : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(items: CompareItem[]) {
  cache = items;
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode: list lives for this page only */ }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = null; l(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
}

export function useCompare() {
  const items = useSyncExternalStore(subscribe, read, () => EMPTY);
  return {
    items,
    has: (id: string) => items.some((i) => i.id === id),
    /** false = list full. */
    add: (item: CompareItem): boolean => {
      const now = read();
      if (now.some((i) => i.id === item.id)) return true;
      if (now.length >= COMPARE_LIMIT) return false;
      write([...now, item]);
      return true;
    },
    remove: (id: string) => write(read().filter((i) => i.id !== id)),
    clear: () => write([]),
    /** Keeps the stored list in step with what the comparison page shows. */
    replace: (next: CompareItem[]) => write(next.slice(0, COMPARE_LIMIT)),
  };
}

export const compareHref = (items: { slug: string }[]) => `/karsilastir?urunler=${items.map((i) => encodeURIComponent(i.slug)).join(",")}`;
