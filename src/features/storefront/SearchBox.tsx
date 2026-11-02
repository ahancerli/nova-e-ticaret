"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { SearchIcon } from "@/components/icons";

export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  return (
    <form role="search" className="relative flex-1"
      onSubmit={(e) => { e.preventDefault(); const t = q.trim(); if (t) router.push(`/ara?q=${encodeURIComponent(t)}`); }}>
      <label htmlFor="site-search" className="sr-only">Ürün, kategori veya marka ara</label>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
      <input id="site-search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100}
        placeholder="Aradığın her şey burada" className="input h-11 rounded-xl bg-ground pl-10 pr-16" />
      <button className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-ink-soft">ARA</button>
    </form>
  );
}
