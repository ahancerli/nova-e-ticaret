import Link from "next/link";
import type { HomeSection } from "@/lib/types";
import { ProductCard } from "../ui/ProductCard";
import { ProductGrid } from "../ui/ProductGrid";
import { DeptIcon, deptColor } from "../ui/department";
import { Rail } from "../ui/Rail";
import { SectionHeader } from "../ui/SectionHeader";
import { Thumb } from "../ui/Thumb";

type Of<T extends HomeSection["type"]> = Extract<HomeSection, { type: T }>;

/**
 * Department tiles (category tiles section): each category in its spectrum colour, the uploaded image or a
 * name-matched icon on a solid disc; scrolls sideways on mobile, a grid from md.
 */
export function CategoryTiles({ s }: { s: Of<"category_tiles"> }) {
  return (
    <section aria-labelledby={`sec-${s.id}`}>
      <SectionHeader id={`sec-${s.id}`} title={s.title} subtitle={s.subtitle} moreHref="/kategoriler" moreLabel="Tüm kategoriler" />
      <ul className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] md:gap-4 md:overflow-visible md:px-0">
        {s.categories.map((c, i) => (
          <li key={c.id} className="w-[7.5rem] flex-none md:w-auto" style={{ "--dept": deptColor(i) } as React.CSSProperties}>
            <Link href={c.href}
              className="group flex h-full flex-col items-start justify-between gap-6 rounded-[20px] border-2 border-transparent bg-[color-mix(in_oklab,var(--dept)_12%,white)] p-3.5 transition hover:border-[var(--dept)] md:p-4">
              {c.imageUrl
                ? <Thumb src={c.imageUrl} name={c.name} className="size-12 md:size-14" rounded="rounded-full" />
                : <span className="grid size-12 place-items-center rounded-full bg-[var(--dept)] text-white md:size-14"><DeptIcon name={c.name} className="size-6 md:size-7" /></span>}
              <span className="font-display text-[15px] font-bold leading-tight text-ink md:text-base">{c.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function StoryStrip({ s }: { s: Of<"story_strip"> }) {
  return (
    <section aria-label={s.title}>
      <ul className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 py-1 md:mx-0 md:px-0">
        {s.stories.map((st) => (
          <li key={st.id} className="flex-none">
            <Link href={st.frames[0]?.href ?? `/marka/${st.brandSlug}`} className="group flex w-[76px] flex-col items-center gap-1.5">
              <span className="block size-[72px] rounded-full bg-[conic-gradient(var(--color-dept-1),var(--color-dept-2),var(--color-dept-4),var(--color-dept-3),var(--color-brand),var(--color-dept-1))] p-[3px] transition group-hover:rotate-12">
                {/* eslint-disable-next-line @next/next/no-img-element -- uploaded / demo asset */}
                <img src={st.coverUrl ?? "/demo/placeholder.svg"} alt="" loading="lazy" className="size-full rounded-full border-[3px] border-white bg-white object-cover" />
              </span>
              <span className="w-full truncate text-center text-xs font-medium text-ink-soft group-hover:text-ink">{st.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Banner({ s, compact = false }: { s: Of<"banner">; compact?: boolean }) {
  const body = (
    <div className="group relative h-full overflow-hidden rounded-3xl bg-ink text-white">
      <picture className="block h-full">
        {s.mobileImageUrl && <source media="(max-width: 767px)" srcSet={s.mobileImageUrl} />}
        <img src={s.imageUrl} alt={s.alt} loading="lazy" className={`w-full object-cover opacity-85 transition duration-500 group-hover:scale-[1.02] ${compact ? "h-full min-h-56" : "h-48 md:h-64"}`} />
      </picture>
      <div className="absolute inset-0 flex flex-col justify-end gap-1.5 bg-gradient-to-t from-ink/90 via-ink/35 to-transparent p-5 md:p-8">
        <h2 className="max-w-lg font-display text-2xl font-extrabold leading-[1.05] tracking-tight md:text-4xl">{s.title}</h2>
        {s.subtitle && <p className="max-w-md text-sm text-white/85 md:text-base">{s.subtitle}</p>}
        {s.href && s.ctaLabel && <span className="mt-3 inline-flex h-10 w-fit items-center rounded-full bg-white px-5 text-sm font-bold text-ink transition group-hover:bg-brand group-hover:text-white">{s.ctaLabel}</span>}
      </div>
    </div>
  );
  return <section aria-label={s.title} className="h-full">{s.href ? <Link href={s.href} className="block h-full">{body}</Link> : body}</section>;
}

export function BrandStrip({ s }: { s: Of<"brand_strip"> }) {
  return (
    <section aria-labelledby={`sec-${s.id}`}>
      <SectionHeader id={`sec-${s.id}`} title={s.title} subtitle={s.subtitle} moreHref="/markalar" moreLabel="Tüm markalar" />
      <Rail label={s.title} itemClass="w-36 md:w-44">
        {s.brands.map((b) => (
          <Link key={b.id} href={b.href} className="flex h-20 items-center justify-center rounded-2xl border border-line bg-white px-3 text-center transition hover:border-ink">
            {/* eslint-disable-next-line @next/next/no-img-element -- uploaded / demo asset */}
            {b.logoUrl ? <img src={b.logoUrl} alt={b.name} loading="lazy" className="max-h-12 max-w-full object-contain" /> : <span className="font-display text-base font-bold leading-tight tracking-tight text-ink md:text-[17px]">{b.name}</span>}
          </Link>
        ))}
      </Rail>
    </section>
  );
}

/** Product carousel (rail) or grid; first row images load eagerly when the section is near the top. */
export function ProductsSection({ s, eager }: { s: Of<"products">; eager: boolean }) {
  if (!s.products.length) return null;
  return (
    <section aria-labelledby={`sec-${s.id}`}>
      <SectionHeader id={`sec-${s.id}`} title={s.title} subtitle={s.subtitle} moreHref={s.moreHref} />
      {s.layout === "grid"
        ? <ProductGrid products={s.products} priorityCount={eager ? 5 : 0} />
        : <Rail label={s.title}>{s.products.map((p, i) => <ProductCard key={p.id} p={p} priority={eager && i < 5} />)}</Rail>}
    </section>
  );
}
