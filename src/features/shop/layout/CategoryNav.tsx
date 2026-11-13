import Link from "next/link";
import type { CategoryNode } from "@/lib/types";
import type { NavItem } from "@/modules/storefront";
import { Thumb } from "../ui/Thumb";
import { findCategory } from "./category-tree";

const MAX_LINKS = 6;

/**
 * Desktop category bar with mega menus, fully server-rendered: hover / keyboard focus opens a panel through
 * CSS only (group-hover, group-focus-within), so it works before hydration and ships no JS. A header item
 * linked to a category shows that category's subtree (children as columns, grandchildren as links, menu
 * image on the right); a manual item shows its own children.
 */
export function CategoryNav({ nav, categories }: { nav: NavItem[]; categories: CategoryNode[] }) {
  return (
    <nav aria-label="Kategoriler" className="relative hidden border-b border-line bg-white md:block">
      <ul className="container-page flex items-stretch justify-between">
        {nav.map((item) => {
          const node = item.categorySlug ? findCategory(categories, item.categorySlug) : null;
          const columns = node?.children.length ? node.children : null;
          const hasPanel = Boolean(columns || item.children.length);
          return (
            <li key={item.id} className="group flex flex-1">
              <Link href={item.href} aria-haspopup={hasPanel || undefined}
                className="flex w-full items-center justify-center border-b-2 border-transparent px-2 py-3 text-center text-sm font-medium leading-tight text-ink-soft transition group-hover:border-brand group-hover:text-brand group-focus-within:border-brand group-focus-within:text-brand">
                {item.label}
              </Link>
              {hasPanel && (
                <div className="invisible absolute inset-x-0 top-full z-40 opacity-0 transition delay-75 duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  <div className="border-t border-line bg-white shadow-[0_16px_32px_rgb(27_36_64/0.12)]">
                    <div className="container-page flex gap-8 py-6">
                      {columns ? <CategoryColumns node={node!} /> : <ul className="grid flex-1 grid-cols-4 gap-2">{item.children.map((c) => <li key={c.id}><Link href={c.href} className="block rounded-lg px-3 py-2 text-sm hover:bg-ground hover:text-brand">{c.label}</Link></li>)}</ul>}
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function CategoryColumns({ node }: { node: CategoryNode }) {
  return (
    <>
      <div className="grid flex-1 grid-cols-2 content-start gap-x-8 gap-y-6 lg:grid-cols-4">
        {node.children.map((c) => (
          <div key={c.id}>
            <Link href={c.href} className="flex items-center gap-3 text-sm font-bold text-ink hover:text-brand">
              <Thumb src={c.imageUrl} name={c.name} className="size-10" rounded="rounded-xl" />
              {c.name}
            </Link>
            {c.children.length > 0 && (
              <ul className="mt-2 space-y-1 pl-[52px] text-sm text-ink-soft">
                {c.children.slice(0, MAX_LINKS).map((g) => <li key={g.id}><Link href={g.href} className="hover:text-brand">{g.name}</Link></li>)}
                {c.children.length > MAX_LINKS && <li><Link href={c.href} className="font-semibold text-brand">Tümü →</Link></li>}
              </ul>
            )}
          </div>
        ))}
      </div>
      <div className="w-56 flex-none">
        {node.menuImageUrl ? (
          <Link href={node.href} className="block overflow-hidden rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- uploaded asset */}
            <img src={node.menuImageUrl} alt={node.name} loading="lazy" className="aspect-[4/3] w-full object-cover" />
          </Link>
        ) : (
          <Link href={node.href} className="flex aspect-[4/3] flex-col justify-end rounded-2xl bg-gradient-to-br from-brand to-brand-dark p-5 text-white">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/80">Keşfet</span>
            <span className="text-xl font-extrabold leading-tight">{node.name}</span>
          </Link>
        )}
        <Link href={node.href} className="mt-3 block text-sm font-semibold text-brand hover:text-brand-dark">Tüm {node.name} ürünleri →</Link>
      </div>
    </>
  );
}
