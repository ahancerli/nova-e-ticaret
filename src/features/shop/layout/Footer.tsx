import Link from "next/link";
import { ArrowUp, ChevronDown, Clock, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import type { FooterLinkColumn } from "@/modules/content";
import type { PublicSettings } from "@/modules/settings";
import type { NavItem } from "@/modules/storefront";
import { CookiePreferencesLink } from "../../consent/CookiePreferencesLink";
import { SocialIcon } from "./SocialIcon";
import { Wordmark } from "./Wordmark";

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
const waHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

/**
 * Storefront footer, server-rendered and fully data-driven: link columns from the footer navigation menu plus
 * every published content page that chose a footer column (legal, corporate, help — a new page appears here
 * without code); social accounts, contact, trust badges and company identity from Site ayarları.
 */
export function Footer({ settings, nav, pageColumns, year, cookiePreferences = false }: {
  settings: PublicSettings; nav: NavItem[]; pageColumns: FooterLinkColumn[]; year: number;
  /** Show the “Çerez tercihleri” link (cookie banner enabled). */
  cookiePreferences?: boolean;
}) {
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
              <li key={t} className="flex items-center justify-center gap-2 text-center"><ShieldCheck className="size-5 flex-none text-dept-3" aria-hidden />{t}</li>
            ))}
          </ul>
        </div>
      )}
      <div aria-hidden className="spectrum h-1" />

      <div className="bg-ink text-white">
        <div className="container-page py-6 md:flex md:flex-wrap md:gap-10 md:py-14 lg:flex-nowrap">
          {columns.map((col) => (
            <FooterColumn key={col.key} label={col.label}>
              <ul className="space-y-2.5 text-sm text-white/70">
                {col.links.map((l) => <li key={l.href}><Link href={l.href} className="hover:text-white">{l.title}</Link></li>)}
              </ul>
            </FooterColumn>
          ))}

          {social.length > 0 && (
            <FooterColumn label="Bizi takip edin">
              <ul className="space-y-2.5 text-sm text-white/70">
                {social.map((s) => (
                  <li key={s.network}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-2.5 hover:text-white">
                      <span className="grid size-8 place-items-center rounded-full bg-white/10 text-white transition group-hover:bg-brand"><SocialIcon network={s.network} className="size-4" /></span>
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </FooterColumn>
          )}

          {hasContact && (
            <div className="pt-8 md:order-first md:basis-full md:pt-0 lg:w-72 lg:flex-none lg:basis-auto">
              <h2 className="mb-4 font-display text-lg font-bold">Aklınıza takılan bir soru mu var?</h2>
              {contact.phone && (
                <p className="text-sm text-white/70">Bizi arayın
                  <a href={telHref(contact.phone)} className="mt-1 block font-display text-[26px] font-extrabold tracking-tight text-white hover:text-brand">{contact.phone}</a>
                </p>
              )}
              <ul className="mt-3 space-y-2 text-sm text-white/70">
                {contact.whatsapp && <li><a href={waHref(contact.whatsapp)} rel="noopener noreferrer" target="_blank" className="inline-flex items-center gap-2 hover:text-white"><MessageCircle className="size-4" aria-hidden />WhatsApp destek</a></li>}
                {contact.email && <li><a href={`mailto:${contact.email}`} className="inline-flex items-center gap-2 hover:text-white"><Mail className="size-4" aria-hidden />{contact.email}</a></li>}
                {contact.hours && <li className="inline-flex items-center gap-2"><Clock className="size-4" aria-hidden />{contact.hours}</li>}
              </ul>
            </div>
          )}
        </div>

        {(identity || footer.paymentNote) && (
          <div className="border-t border-white/10">
            <div className="container-page flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-5 text-xs text-white/55">
              {identity && <span>{identity}</span>}
              {footer.paymentNote && <span className="font-medium text-white/75">{footer.paymentNote}</span>}
            </div>
          </div>
        )}
      </div>

      <div className="bg-[color-mix(in_oklab,var(--color-ink)_80%,black)] text-white">
        <div className="container-page flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="space-y-1">
            <p className="text-sm">{copyright}</p>
            {settings.tagline && <p className="text-xs text-white/60">{settings.tagline}</p>}
            {cookiePreferences && <CookiePreferencesLink className="text-xs text-white/70 underline decoration-white/30 underline-offset-4 hover:text-white" />}
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden opacity-90 sm:block [&_*]:!text-white"><Wordmark name={settings.siteName} logoUrl={null} /></span>
            <a href="#" className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-ink hover:bg-brand hover:text-white">
              <ArrowUp className="size-4" aria-hidden />Başa dön
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/** Link column: an accordion on phones (keeps the footer short), always open from md. */
function FooterColumn({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <details className="group border-b border-white/10 md:hidden">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
          <h2 className="font-display text-base font-bold">{label}</h2>
          <ChevronDown className="size-5 text-white/60 transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="pb-5">{children}</div>
      </details>
      <nav aria-label={label} className="hidden min-w-32 flex-1 md:block">
        <h2 className="mb-4 font-display text-base font-bold">{label}</h2>
        {children}
      </nav>
    </>
  );
}
