import Link from "next/link";
import { Clock, Mail, MessageCircle, Phone } from "lucide-react";
import type { FooterLinkColumn } from "@/modules/content";
import type { PublicSettings } from "@/modules/settings";
import type { NavItem } from "@/modules/storefront";
import { SocialIcon } from "./SocialIcon";
import { Wordmark } from "./Wordmark";

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
const waHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

/**
 * Storefront footer, fully data-driven: trust badges, contact and social accounts from Site ayarları; link columns
 * from the footer navigation menu plus every published content page that chose a footer column (legal texts,
 * corporate, help) — a new page appears here without touching code.
 */
export function Footer({ settings, nav, pageColumns, year }: { settings: PublicSettings; nav: NavItem[]; pageColumns: FooterLinkColumn[]; year: number }) {
  const { contact, company, footer, social } = settings;
  const columns = [
    ...nav.filter((col) => col.children.length > 0).map((col) => ({ key: col.id, label: col.label, links: col.children.map((c) => ({ title: c.label, href: c.href })) })),
    ...pageColumns.map((col) => ({ key: col.column, label: col.label, links: col.links })),
  ];
  const copyright = footer.copyright ? footer.copyright.replaceAll("{{yil}}", String(year)) : `© ${year} ${settings.siteName}`;
  const identity = [company.legalName, company.mersisNo && `MERSİS: ${company.mersisNo}`].filter(Boolean).join(" · ");

  return (
    <footer className="mt-16 border-t border-line bg-white">
      {footer.trustBadges.length > 0 && (
        <div className="container-page grid grid-cols-2 gap-4 border-b border-line py-6 text-sm font-medium md:grid-cols-4">
          {footer.trustBadges.map((t) => (
            <p key={t} className="flex items-center justify-center gap-2 text-center text-ink-soft"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />{t}</p>
          ))}
        </div>
      )}

      <div className="container-page grid gap-10 py-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,3fr)]">
        <div className="space-y-4">
          <Wordmark name={settings.siteName} logoUrl={settings.logoUrl} className="h-8" />
          {settings.tagline && <p className="max-w-xs text-sm text-muted">{settings.tagline}</p>}
          <ul className="space-y-2 text-sm text-ink-soft">
            {contact.phone && <li><a href={telHref(contact.phone)} className="inline-flex items-center gap-2 hover:text-ink"><Phone className="size-4 text-muted" aria-hidden />{contact.phone}</a></li>}
            {contact.whatsapp && <li><a href={waHref(contact.whatsapp)} rel="noopener noreferrer" target="_blank" className="inline-flex items-center gap-2 hover:text-ink"><MessageCircle className="size-4 text-muted" aria-hidden />WhatsApp destek</a></li>}
            {contact.email && <li><a href={`mailto:${contact.email}`} className="inline-flex items-center gap-2 hover:text-ink"><Mail className="size-4 text-muted" aria-hidden />{contact.email}</a></li>}
            {contact.hours && <li className="inline-flex items-center gap-2"><Clock className="size-4 text-muted" aria-hidden />{contact.hours}</li>}
          </ul>
          {social.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Sosyal medya hesaplarımız">
              {social.map((s) => (
                <li key={s.network}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" aria-label={s.label}
                    className="inline-flex size-9 items-center justify-center rounded-full border border-line text-ink-soft transition hover:border-brand hover:text-brand">
                    <SocialIcon network={s.network} className="size-4" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {columns.length > 0 && (
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-4">
            {columns.map((col) => (
              <nav key={col.key} aria-label={col.label}>
                <p className="mb-3 text-sm font-semibold">{col.label}</p>
                <ul className="space-y-2 text-sm text-muted">
                  {col.links.map((l) => <li key={l.href}><Link href={l.href} className="hover:text-ink">{l.title}</Link></li>)}
                </ul>
              </nav>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-line">
        <div className="container-page flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4 text-xs text-muted">
          <span>{copyright}</span>
          {identity && <span>{identity}</span>}
          {footer.paymentNote && <span>{footer.paymentNote}</span>}
        </div>
      </div>
    </footer>
  );
}
