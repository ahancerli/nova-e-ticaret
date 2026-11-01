import Link from "next/link";
import type { NavItem } from "@/server/services/catalog";

export function Footer({ nav, tagline }: { nav: NavItem[]; tagline?: string }) {
  return (
    <footer className="mt-16 border-t border-line bg-white">
      <div className="container-page grid grid-cols-2 gap-4 border-b border-line py-6 text-sm font-medium md:grid-cols-4">
        {["Güvenli ödeme", "Özenli teslimat", "Seçilmiş markalar", "Kolay destek"].map((t) => (
          <p key={t} className="flex items-center justify-center gap-2 text-ink-soft"><span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />{t}</p>
        ))}
      </div>
      <div className="container-page grid gap-8 py-10 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <p className="text-2xl font-extrabold">nova<span className="text-brand">.</span></p>
          {tagline && <p className="mt-2 text-sm text-muted">{tagline}</p>}
        </div>
        {nav.map((col) => (
          <div key={col.id}>
            <p className="mb-3 text-sm font-semibold">{col.label}</p>
            <ul className="space-y-2 text-sm text-muted">
              {col.children.map((c) => <li key={c.id}><Link href={c.href} className="hover:text-ink">{c.label}</Link></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="container-page flex flex-wrap items-center justify-between gap-2 border-t border-line py-4 text-xs text-muted">
        <span>© {new Date().getFullYear()} nova. — Tasarım konsepti</span>
        <span>iyzico · Havale / EFT · TL</span>
      </div>
    </footer>
  );
}
