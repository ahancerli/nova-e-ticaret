import Link from "next/link";
import { Suspense } from "react";
import type { NavItem } from "@/modules/storefront";
import { CartButton } from "@/components/cart/CartButton";
import { SearchBox } from "./SearchBox";
import { MobileMenu } from "./MobileMenu";
import { UserIcon } from "@/components/icons";
import { currentPrincipal } from "@/server/app";

/** Server component: menu/public settings from D1, account CTA from storefront session cookie. */
export async function Header({ nav, announcement }: { nav: NavItem[]; announcement?: { text: string; href?: string } }) {
  const user = await currentPrincipal("storefront");
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      {announcement?.text && (
        <div className="bg-navy py-2 text-center text-xs text-white">
          {announcement.href ? <Link href={announcement.href} className="hover:underline">{announcement.text}</Link> : announcement.text}
        </div>
      )}
      <div className="container-page flex items-center gap-3 py-3 md:gap-6">
        <MobileMenu nav={nav} />
        <Link href="/" className="text-2xl font-extrabold tracking-tight text-ink md:text-[28px]" aria-label="nova ana sayfa">
          nova<span className="text-brand">.</span>
        </Link>
        <div className="hidden flex-1 md:flex">
          <Suspense><SearchBox /></Suspense>
        </div>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Link href={user ? "/hesabim" : "/giris"} className="hidden items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-ground sm:flex">
            <UserIcon />
            <span className="leading-tight">
              <span className="block text-[11px] text-muted">{user ? "Hesabım" : "Merhaba"}</span>
              <span className="font-semibold">{user ? user.displayName : "Giriş yap"}</span>
            </span>
          </Link>
          <CartButton />
        </div>
      </div>
      <div className="container-page pb-3 md:hidden"><Suspense><SearchBox /></Suspense></div>
      <nav aria-label="Kategoriler" className="hidden border-t border-line md:block">
        <ul className="container-page no-scrollbar flex items-center gap-8 overflow-x-auto py-3 text-sm font-medium">
          {nav.map((item) => (
            <li key={item.id} className="group relative">
              <Link href={item.href} className={`whitespace-nowrap hover:text-brand ${item.href.includes("kampanya") ? "text-brand" : ""}`}>{item.label}</Link>
              {item.children.length > 0 && (
                <div className="invisible absolute left-0 top-full z-50 min-w-56 pt-3 opacity-0 transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                  <ul className="card p-3 shadow-lg">
                    {item.children.map((c) => (
                      <li key={c.id}><Link href={c.href} className="block rounded-lg px-3 py-2 hover:bg-ground">{c.label}</Link></li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
