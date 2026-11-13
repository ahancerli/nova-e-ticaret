import Link from "next/link";
import type { HomeSection } from "@/lib/types";
import { ProductCard } from "../ui/ProductCard";
import { ProductGrid } from "../ui/ProductGrid";
import { Rail } from "../ui/Rail";
import { SectionHeader } from "../ui/SectionHeader";
import { Thumb } from "../ui/Thumb";

type Of<T extends HomeSection["type"]> = Extract<HomeSection, { type: T }>;

/** Round-cornered quick links (category tiles section): image or initial, name under it, scrolls on mobile. */
export function CategoryTiles({ s }: { s: Of<"category_tiles"> }) {
  return (
    <section aria-labelledby={`sec-${s.id}`}>
      <SectionHeader id={`sec-${s.id}`} title={s.title} subtitle={s.subtitle} moreHref="/kategoriler" moreLabel="Tüm kategoriler" />
      <ul className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] md:overflow-visible md:px-0">
        {s.categories.map((c) => (
          <li key={c.id} className="w-24 flex-none md:w-auto">
            <Link href={c.href} className="group flex flex-col items-center gap-2 rounded-2xl p-2 text-center transition hover:bg-white hover:shadow-sm">
              <Thumb src={c.imageUrl} name={c.name} className="aspect-[4/3] w-full" rounded="rounded-xl" />
              <span className="line-clamp-2 text-xs font-semibold leading-4 text-ink group-hover:text-brand">{c.name}</span>
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
              <span className="block size-[72px] rounded-full bg-gradient-to-tr from-brand via-amber-400 to-brand-dark p-[3px] transition group-hover:scale-105">
                {/* eslint-disable-next-line @next/next/no-img-element -- uploaded / demo asset */}
                <img src={st.coverUrl ?? "/demo/placeholder.svg"} alt="" loading="lazy" className="size-full rounded-full border-[3px] border-white bg-white object-cover" />
              </span>
              <span className="w-full truncate text-center text-xs font-medium group-hover:text-brand">{st.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Banner({ s, compact = false }: { s: Of<"banner">; compact?: boolean }) {
  const body = (
    <div className="group relative h-full overflow-hidden rounded-2xl bg-ink text-white">
      <picture className="block h-full">
        {s.mobileImageUrl && <source media="(max-width: 767px)" srcSet={s.mobileImageUrl} />}
        <img src={s.imageUrl} alt={s.alt} loading="lazy" className={`w-full object-cover opacity-85 transition duration-500 group-hover:scale-[1.02] ${compact ? "h-full min-h-56" : "h-48 md:h-64"}`} />
      </picture>
      <div className="absolute inset-0 flex flex-col justify-end gap-1.5 bg-gradient-to-t from-ink/85 via-ink/30 to-transparent p-5 md:p-8">
        <h2 className="max-w-lg text-xl font-extrabold leading-tight md:text-3xl">{s.title}</h2>
        {s.subtitle && <p className="max-w-md text-sm text-white/85 md:text-base">{s.subtitle}</p>}
        {s.href && s.ctaLabel && <span className="mt-2 inline-flex w-fit items-center rounded-lg bg-brand px-4 py-2 text-sm font-bold">{s.ctaLabel} →</span>}
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
          <Link key={b.id} href={b.href} className="flex h-20 items-center justify-center rounded-xl border border-line bg-white px-4 text-center font-bold text-ink-soft transition hover:border-brand hover:text-brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- uploaded / demo asset */}
            {b.logoUrl ? <img src={b.logoUrl} alt={b.name} loading="lazy" className="max-h-12 max-w-full object-contain" /> : b.name}
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
