import Link from "next/link";
import { ArrowUp, Clock, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import type { FooterLinkColumn } from "@/modules/content";
import type { PublicSettings } from "@/modules/settings";
import type { NavItem } from "@/modules/storefront";
import { SocialIcon } from "./SocialIcon";
import { Wordmark } from "./Wordmark";

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
const waHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

/**
 * Storefront footer, server-rendered and fully data-driven: link columns from the footer navigation menu plus
 * every published content page that chose a footer column (legal, corporate, help — a new page appears here
 * without code); social accounts, contact, trust badges and company identity from Site ayarları.
 */
export function Footer({ settings, nav, pageColumns, year }: { settings: PublicSettings; nav: NavItem[]; pageColumns: FooterLinkColumn[]; year: number }) {
  const { contact, company, footer, social } = settings;
  const columns = [
    ...nav.filter((col) => col.children.length > 0).map((col) => ({ key: col.id, label: col.label, links: col.children.map((c) => ({ title: c.label, href: c.href })) })),
    ...pageColumns.map((col) => ({ key: col.column, label: col.label, links: col.links })),
  ];
  const copyright = footer.copyright ? footer.copyright.replaceAll("{{yil}}", String(year)) : `© ${year} ${settings.siteName}`;
  const identity = [company.legalName, company.mersisNo && `MERSİS: ${company.mersisNo}`, company.address].filter(Boolean).join(" · ");
  const hasContact = Boolean(contact.phone || contact.email || contact.whatsapp);

  return (
    <footer className="mt-16">
      {footer.trustBadges.length > 0 && (
        <div className="border-y border-line bg-white">
          <ul className="container-page grid grid-cols-2 gap-4 py-5 text-sm font-semibold text-ink-soft md:grid-cols-4">
            {footer.trustBadges.map((t) => (
              <li key={t} className="flex items-center justify-center gap-2 text-center"><ShieldCheck className="size-5 flex-none text-brand" aria-hidden />{t}</li>
            ))}
          </ul>
        </div>
      )}
      <div aria-hidden className="h-1 bg-gradient-to-r from-brand via-brand to-navy" />

      <div className="bg-brand-soft">
        <div className="container-page grid gap-10 py-12 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
          {columns.map((col) => (
            <nav key={col.key} aria-label={col.label}>
              <h2 className="mb-4 text-[15px] font-bold text-brand">{col.label}</h2>
              <ul className="space-y-2.5 text-sm text-ink-soft">
                {col.links.map((l) => <li key={l.href}><Link href={l.href} className="hover:text-brand">{l.title}</Link></li>)}
              </ul>
            </nav>
          ))}

          {social.length > 0 && (
            <div>
              <h2 className="mb-4 text-[15px] font-bold text-brand">Bizi takip edin</h2>
              <ul className="space-y-2.5 text-sm text-ink-soft">
                {social.map((s) => (
                  <li key={s.network}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-2.5 hover:text-brand">
                      <span className="grid size-8 place-items-center rounded-full bg-ink text-white transition group-hover:bg-brand"><SocialIcon network={s.network} className="size-4" /></span>
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasContact && (
            <div className="md:min-w-60">
              <h2 className="mb-4 text-[15px] font-bold text-brand">Aklınıza takılan bir soru mu var?</h2>
              {contact.phone && (
                <p className="text-sm text-ink-soft">Bizi arayın
                  <a href={telHref(contact.phone)} className="mt-1 block text-2xl font-extrabold tracking-tight text-ink hover:text-brand">{contact.phone}</a>
                </p>
              )}
              <ul className="mt-3 space-y-2 text-sm text-ink-soft">
                {contact.whatsapp && <li><a href={waHref(contact.whatsapp)} rel="noopener noreferrer" target="_blank" className="inline-flex items-center gap-2 hover:text-brand"><MessageCircle className="size-4" aria-hidden />WhatsApp destek</a></li>}
                {contact.email && <li><a href={`mailto:${contact.email}`} className="inline-flex items-center gap-2 hover:text-brand"><Mail className="size-4" aria-hidden />{contact.email}</a></li>}
                {contact.hours && <li className="inline-flex items-center gap-2"><Clock className="size-4" aria-hidden />{contact.hours}</li>}
              </ul>
            </div>
          )}
        </div>

        {(identity || footer.paymentNote) && (
          <div className="border-t border-brand/15">
            <div className="container-page flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-5 text-xs text-ink-soft">
              {identity && <span>{identity}</span>}
              {footer.paymentNote && <span className="font-medium">{footer.paymentNote}</span>}
            </div>
          </div>
        )}
      </div>

      <div className="bg-ink text-white">
        <div className="container-page flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="space-y-1">
            <p className="text-sm">{copyright}</p>
            {settings.tagline && <p className="text-xs text-white/60">{settings.tagline}</p>}
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden opacity-90 sm:block [&_*]:!text-white"><Wordmark name={settings.siteName} logoUrl={null} /></span>
            <a href="#" className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-soft">
              <ArrowUp className="size-4" aria-hidden />Başa dön
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
