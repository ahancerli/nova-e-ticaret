import Link from "next/link";

/** Title row of a storefront section: optional eyebrow, heading (id for aria-labelledby), "Tümünü gör" link. */
export function SectionHeader({ id, title, subtitle, moreHref, moreLabel = "Tümünü gör" }: {
  id: string; title: string; subtitle?: string | null; moreHref?: string; moreLabel?: string;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div className="border-l-4 border-brand pl-3">
        {subtitle && <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">{subtitle}</p>}
        <h2 id={id} className="text-xl font-extrabold tracking-tight text-ink md:text-2xl">{title}</h2>
      </div>
      {moreHref && (
        <Link href={moreHref} className="flex-none rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-semibold text-ink-soft transition hover:border-brand hover:text-brand">
          {moreLabel} →
        </Link>
      )}
    </div>
  );
}
