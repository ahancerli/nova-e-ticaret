"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { NavItem } from "@/modules/storefront";
import { CloseIcon, MenuIcon } from "@/components/icons";
import { Wordmark } from "./Wordmark";

export function MobileMenu({ nav, siteName, logoUrl }: { nav: NavItem[]; siteName: string; logoUrl: string | null }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button className="rounded-lg p-2 hover:bg-ground md:hidden" aria-label="Menüyü aç" aria-expanded={open} onClick={() => setOpen(true)}><MenuIcon /></button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button className="absolute inset-0 bg-black/30" aria-label="Menüyü kapat" tabIndex={-1} onClick={() => setOpen(false)} />
          <nav aria-label="Mobil menü" className="absolute left-0 top-0 h-full w-80 max-w-[85vw] overflow-y-auto bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <Wordmark name={siteName} logoUrl={logoUrl} className="h-7" />
              <button className="p-2" aria-label="Kapat" onClick={() => setOpen(false)}><CloseIcon /></button>
            </div>
            <ul className="space-y-1">
              {nav.map((i) => (
                <li key={i.id}>
                  <Link href={i.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 font-medium hover:bg-ground">{i.label}</Link>
                  {i.children.length > 0 && (
                    <ul className="ml-3 border-l border-line pl-3">
                      {i.children.map((c) => <li key={c.id}><Link href={c.href} onClick={() => setOpen(false)} className="block px-3 py-2 text-sm text-ink-soft">{c.label}</Link></li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </>
  );
}
