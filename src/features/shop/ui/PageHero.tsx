import Link from "next/link";
import { ChevronRight, House } from "lucide-react";
import { BRAND_TONE, type Tone } from "./department";

/**
 * Coloured title band at the top of inner storefront pages (listings, product, account, auth, cart): the page's
 * department colour (or the brand / ink tone), breadcrumb, display-size title. Server-renderable, no hooks.
 */
export function PageHero({ title, subtitle, breadcrumb, tone = BRAND_TONE, compact = false, children }: {
  title: React.ReactNode; subtitle?: React.ReactNode; breadcrumb?: { name: string; href?: string }[]; tone?: Tone; compact?: boolean; children?: React.ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden" style={{ background: tone.bg, color: tone.fg }}>
      {/* The "nova" burst: one large ring set, the band's only decoration. */}
      <span aria-hidden className="absolute -right-24 -top-28 -z-10 size-[26rem] rounded-full border-[56px] border-current opacity-[0.09] md:-right-10 md:size-[30rem]" />
      <span aria-hidden className="absolute right-28 top-16 -z-10 hidden size-24 rounded-full bg-current opacity-[0.12] md:block" />
      <div className={`container-page ${compact ? "py-6 md:py-8" : "py-7 md:py-11"}`}>
        {breadcrumb && (
          <nav aria-label="Sayfa yolu" className="mb-3 text-[13px] md:mb-4">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li><Link href="/" className="flex items-center opacity-75 hover:opacity-100" aria-label="Ana sayfa"><House className="size-4" /></Link></li>
              {breadcrumb.map((b, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <ChevronRight className="size-3.5 opacity-60" aria-hidden />
                  {b.href ? <Link href={b.href} className="font-medium opacity-75 hover:opacity-100">{b.name}</Link> : <span aria-current="page" className="font-semibold">{b.name}</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className={`max-w-3xl font-display font-extrabold leading-[1.02] tracking-[-0.03em] ${compact ? "text-[28px] md:text-[40px]" : "text-[34px] md:text-[56px]"}`}>{title}</h1>
        {subtitle && <div className="mt-2 max-w-xl text-[15px] opacity-85 md:mt-3 md:text-base">{subtitle}</div>}
        {children && <div className="mt-5">{children}</div>}
      </div>
    </section>
  );
}
