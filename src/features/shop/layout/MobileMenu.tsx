"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CategoryNode } from "@/lib/types";
import type { NavItem } from "@/modules/storefront";
import { ChevronIcon, CloseIcon, MenuIcon, UserIcon } from "@/components/icons";
import { Thumb } from "../ui/Thumb";
import { Wordmark } from "./Wordmark";
import { findCategory } from "./category-tree";

type Level = { title: string; href: string; items: { id: string; label: string; href: string; imageUrl: string | null; sub: CategoryNode | null }[] };

const fromNode = (n: CategoryNode): Level => ({
  title: n.name, href: n.href,
  items: n.children.map((c) => ({ id: c.id, label: c.name, href: c.href, imageUrl: c.imageUrl, sub: c.children.length ? c : null })),
});

/** Mobile drawer: header menu items, drilling into category subtrees level by level (with a back step). */
export function MobileMenu({ nav, categories, siteName, logoUrl, signedIn }: {
  nav: NavItem[]; categories: CategoryNode[]; siteName: string; logoUrl: string | null; signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<Level[]>([]);
  const close = () => { setOpen(false); setStack([]); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  const root: Level["items"] = nav.map((i) => {
    const node = i.categorySlug ? findCategory(categories, i.categorySlug) : null;
    return { id: i.id, label: i.label, href: i.href, imageUrl: node?.imageUrl ?? null, sub: node?.children.length ? node : null };
  });
  const level = stack.at(-1);
  const items = level?.items ?? root;
  const row = "flex min-h-12 w-full items-center gap-3 border-b border-line px-4 text-left text-[15px]";

  return (
    <>
      <button type="button" className="grid size-10 place-items-center rounded-lg hover:bg-ground md:hidden" aria-label="Menüyü aç" aria-expanded={open} onClick={() => setOpen(true)}><MenuIcon /></button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menü">
          <button className="absolute inset-0 animate-fade-in bg-ink/40" aria-label="Menüyü kapat" tabIndex={-1} onClick={close} />
          <nav aria-label="Mobil menü" className="absolute inset-y-0 left-0 flex w-[min(22rem,88vw)] animate-slide-in-left flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <Wordmark name={siteName} logoUrl={logoUrl} className="h-7" />
              <button type="button" className="grid size-10 place-items-center rounded-lg hover:bg-ground" aria-label="Kapat" onClick={close}><CloseIcon /></button>
            </div>
            <Link href={signedIn ? "/hesabim" : "/giris"} onClick={close} className="flex items-center gap-3 bg-brand-soft px-4 py-3 text-sm font-semibold text-brand-dark">
              <UserIcon /> {signedIn ? "Hesabım" : "Giriş yap veya üye ol"}
            </Link>
            <div className="flex-1 overflow-y-auto">
              {level && (
                <>
                  <button type="button" onClick={() => setStack((s) => s.slice(0, -1))} className={`${row} font-semibold text-ink-soft`}>
                    <ChevronIcon dir="left" /> Geri
                  </button>
                  <Link href={level.href} onClick={close} className={`${row} font-bold text-brand`}>Tüm {level.title} ürünleri</Link>
                </>
              )}
              <ul>
                {items.map((it) => (
                  <li key={it.id}>
                    {it.sub ? (
                      <button type="button" onClick={() => setStack((s) => [...s, fromNode(it.sub!)])} className={row}>
                        <Thumb src={it.imageUrl} name={it.label} className="size-9" rounded="rounded-lg" />
                        <span className="flex-1 font-medium">{it.label}</span><ChevronIcon />
                      </button>
                    ) : (
                      <Link href={it.href} onClick={close} className={row}>
                        <Thumb src={it.imageUrl} name={it.label} className="size-9" rounded="rounded-lg" />
                        <span className="flex-1 font-medium">{it.label}</span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
