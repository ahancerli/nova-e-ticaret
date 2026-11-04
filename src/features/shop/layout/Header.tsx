import Link from "next/link";
import { Suspense } from "react";
import type { CategoryNode } from "@/lib/types";
import type { NavItem } from "@/modules/storefront";
import type { PublicSettings } from "@/modules/settings";
import { UserIcon } from "@/components/icons";
import { currentPrincipal } from "@/server/app";
import { CartButton } from "./CartButton";
import { CategoryNav } from "./CategoryNav";
import { MobileMenu } from "./MobileMenu";
import { SearchBox } from "./SearchBox";
import { Wordmark } from "./Wordmark";

const UTILITY_LINKS = [
  { href: "/hesabim", label: "Siparişlerim" },
  { href: "/kampanyalar", label: "Kampanyalar" },
  { href: "/kategoriler", label: "Tüm kategoriler" },
  { href: "/markalar", label: "Markalar" },
];

/**
 * Storefront header, server-rendered from D1 (menus, category tree, public settings) and the session cookie.
 * Client islands: search suggestions, cart button, mobile drawer.
 */
export async function Header({ nav, categories, settings }: { nav: NavItem[]; categories: CategoryNode[]; settings: PublicSettings }) {
  const user = await currentPrincipal("storefront");
  const { siteName, logoUrl, tagline, announcement } = settings;
  return (
    <>
      <div id="top" className="hidden border-b border-line bg-white md:block">
        <div className="container-page flex h-9 items-center justify-between gap-6 text-xs">
          {announcement?.text
            ? (announcement.href ? <Link href={announcement.href} className="truncate font-semibold text-brand hover:underline">{announcement.text}</Link> : <span className="truncate font-semibold text-brand">{announcement.text}</span>)
            : <span />}
          <ul className="flex flex-none items-center gap-5 text-ink-soft">
            {UTILITY_LINKS.map((l) => <li key={l.href}><Link href={l.href} className="hover:text-brand">{l.label}</Link></li>)}
          </ul>
        </div>
      </div>
      {announcement?.text && (
        <div className="bg-brand px-4 py-2 text-center text-xs font-semibold text-white md:hidden">
          {announcement.href ? <Link href={announcement.href}>{announcement.text}</Link> : announcement.text}
        </div>
      )}

      {/* Sticky must be a direct child of the page flow — inside a wrapper it would scroll away with it. */}
      <header className="sticky top-0 z-40 bg-white shadow-[0_1px_0_var(--color-line)]">
        <div className="container-page flex items-center gap-2 py-3 md:gap-8 md:py-4">
          <MobileMenu nav={nav} categories={categories} siteName={siteName} logoUrl={logoUrl} signedIn={Boolean(user)} />
          <Link href="/" aria-label={`${siteName} ana sayfa`} className="flex shrink-0 flex-col">
            <Wordmark name={siteName} logoUrl={logoUrl} />
            {tagline && <span className="hidden max-w-48 truncate text-[11px] font-semibold text-brand lg:block">{tagline}</span>}
          </Link>
          <div className="hidden max-w-2xl flex-1 md:block"><Suspense><SearchBox /></Suspense></div>
          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <AccountMenu name={user?.displayName ?? null} />
            <CartButton />
          </div>
        </div>
        <div className="container-page pb-3 md:hidden"><Suspense><SearchBox /></Suspense></div>
        <div aria-hidden className="h-[3px] bg-gradient-to-r from-brand via-brand to-navy" />
        <CategoryNav nav={nav} categories={categories} />
      </header>
    </>
  );
}

/** Signed in → account link; anonymous → sign-in with a hover/focus panel offering sign-up (CSS only). */
function AccountMenu({ name }: { name: string | null }) {
  const box = "flex h-11 items-center gap-2 rounded-xl border border-line px-3 text-left transition hover:border-brand";
  if (name) {
    return (
      <Link href="/hesabim" className={box} aria-label={`Hesabım, ${name}`}>
        <UserIcon className="size-5 text-ink-soft" />
        <span className="hidden leading-tight lg:block"><span className="block text-[11px] text-muted">Hesabım</span><span className="block max-w-28 truncate text-sm font-semibold">{name}</span></span>
      </Link>
    );
  }
  return (
    <div className="group relative">
      <Link href="/giris" className={box}>
        <UserIcon className="size-5 text-ink-soft" />
        <span className="hidden leading-tight lg:block"><span className="block text-sm font-semibold">Giriş yap</span><span className="block text-[11px] text-muted">veya üye ol</span></span>
        <span className="sr-only lg:hidden">Giriş yap</span>
      </Link>
      <div className="invisible absolute right-0 top-full z-50 w-56 pt-2 opacity-0 transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
        <div className="space-y-2 rounded-2xl border border-line bg-white p-3 shadow-xl">
          <Link href="/giris" className="btn btn-primary w-full">Giriş yap</Link>
          <Link href="/uye-ol" className="btn btn-ghost w-full">Üye ol</Link>
        </div>
      </div>
    </div>
  );
}
