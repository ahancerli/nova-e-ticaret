import Link from "next/link";
import { Suspense } from "react";
import type { CategoryNode } from "@/lib/types";
import type { NavItem } from "@/modules/storefront";
import type { PublicSettings } from "@/modules/settings";
import { UserIcon } from "@/components/icons";
import { currentPrincipal } from "@/server/app";
import { Bell, KeyRound, MapPin, Package, Star, UserRound } from "lucide-react";
import { LogoutButton } from "@/features/account/LogoutButton";
import { accountHref, type AccountTab } from "@/features/account/tabs";
import { CartButton } from "./CartButton";
import { CategoryNav } from "./CategoryNav";
import { MobileMenu } from "./MobileMenu";
import { SearchBox } from "./SearchBox";
import { Wordmark } from "./Wordmark";

const UTILITY_LINKS = [
  { href: "/hesabim", label: "Siparişlerim" },
  { href: "/siparis-sorgula", label: "Sipariş sorgula" },
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
      <div id="top" className="hidden bg-ink text-white md:block">
        <div className="container-page flex h-9 items-center justify-between gap-6 text-xs">
          {announcement?.text
            ? (announcement.href ? <Link href={announcement.href} className="truncate font-medium hover:underline">{announcement.text}</Link> : <span className="truncate font-medium">{announcement.text}</span>)
            : <span />}
          <ul className="flex flex-none items-center gap-5 text-white/70">
            {UTILITY_LINKS.map((l) => <li key={l.href}><Link href={l.href} className="hover:text-white">{l.label}</Link></li>)}
          </ul>
        </div>
      </div>
      {announcement?.text && (
        <div className="bg-ink px-4 py-2 text-center text-xs font-medium text-white md:hidden">
          {announcement.href ? <Link href={announcement.href}>{announcement.text}</Link> : announcement.text}
        </div>
      )}

      {/* Sticky must be a direct child of the page flow — inside a wrapper it would scroll away with it. */}
      <header className="sticky top-0 z-40 bg-white shadow-[0_1px_0_var(--color-line)]">
        <div className="container-page flex items-center gap-2 py-3 md:gap-6 md:py-4 lg:gap-10">
          <MobileMenu nav={nav} categories={categories} siteName={siteName} logoUrl={logoUrl} signedIn={Boolean(user)} />
          <Link href="/" aria-label={`${siteName} ana sayfa`} className="flex shrink-0 flex-col">
            <Wordmark name={siteName} logoUrl={logoUrl} />
            {tagline && <span className="mt-1 hidden max-w-48 truncate text-[11px] font-medium text-ink-soft lg:block">{tagline}</span>}
          </Link>
          <div className="hidden max-w-2xl flex-1 md:block"><Suspense><SearchBox /></Suspense></div>
          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <AccountMenu user={user ? { name: user.displayName, email: user.email } : null} />
            <CartButton />
          </div>
        </div>
        <div className="container-page pb-3 md:hidden"><Suspense><SearchBox /></Suspense></div>
        <div aria-hidden className="spectrum h-[3px]" />
        <CategoryNav nav={nav} categories={categories} />
      </header>
    </>
  );
}

const ACCOUNT_LINKS: { tab: AccountTab; label: string; icon: typeof Package }[] = [
  { tab: "siparisler", label: "Siparişlerim", icon: Package },
  { tab: "bilgiler", label: "Kişisel bilgilerim", icon: UserRound },
  { tab: "adresler", label: "Adreslerim", icon: MapPin },
  { tab: "degerlendirmeler", label: "Değerlendirmelerim", icon: Star },
  { tab: "haber-ver", label: "Haber ver listem", icon: Bell },
  { tab: "sifre", label: "Şifre ve güvenlik", icon: KeyRound },
];

/**
 * Signed in → account link with a hover/focus panel (sections of Hesabım + sign-out); anonymous → sign-in with a
 * panel offering sign-up. CSS only (group-hover / focus-within), like the mega menu; the link itself still works on touch.
 */
function AccountMenu({ user }: { user: { name: string; email: string } | null }) {
  const box = "flex h-11 items-center gap-2 rounded-full px-3 text-left transition hover:bg-ground group-focus-within:bg-ground";
  const panel = "invisible absolute right-0 top-full z-50 pt-2 opacity-0 transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100";
  if (user) {
    return (
      <div className="group relative">
        <Link href="/hesabim" className={box} aria-label={`Hesabım, ${user.name}`} aria-haspopup="true">
          <UserIcon className="size-5 text-ink-soft" />
          <span className="hidden leading-tight lg:block"><span className="block text-[11px] text-muted">Hesabım</span><span className="block max-w-28 truncate text-sm font-semibold">{user.name}</span></span>
        </Link>
        <div className={`${panel} w-64`}>
          <nav aria-label="Hesap menüsü" className="overflow-hidden rounded-2xl border border-line bg-white shadow-xl">
            <div aria-hidden className="spectrum h-[3px]" />
            <div className="px-4 pb-3 pt-3.5">
              <p className="truncate font-display text-[15px] font-bold leading-tight">{user.name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
            <ul className="border-y border-line py-1.5">
              {ACCOUNT_LINKS.map(({ tab, label, icon: Icon }) => (
                <li key={tab}>
                  <Link href={accountHref(tab)} className="flex items-center gap-3 px-4 py-2 text-sm font-medium text-ink-soft transition hover:bg-ground hover:text-ink focus-visible:bg-ground focus-visible:text-ink focus-visible:outline-none">
                    <Icon className="size-4 flex-none" aria-hidden />{label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="p-2">
              <LogoutButton className="flex w-full items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold text-danger transition hover:bg-red-50 disabled:opacity-60" />
            </div>
          </nav>
        </div>
      </div>
    );
  }
  return (
    <div className="group relative">
      <Link href="/giris" className={box}>
        <UserIcon className="size-5 text-ink-soft" />
        <span className="hidden leading-tight lg:block"><span className="block text-sm font-semibold">Giriş yap</span><span className="block text-[11px] text-muted">veya üye ol</span></span>
        <span className="sr-only lg:hidden">Giriş yap</span>
      </Link>
      <div className={`${panel} w-56`}>
        <div className="space-y-2 rounded-2xl border border-line bg-white p-3 shadow-xl">
          <Link href="/giris" className="btn btn-primary w-full">Giriş yap</Link>
          <Link href="/uye-ol" className="btn btn-ghost w-full">Üye ol</Link>
        </div>
      </div>
    </div>
  );
}
