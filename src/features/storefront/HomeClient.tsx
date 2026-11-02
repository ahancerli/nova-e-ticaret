"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { storefrontApi } from "./api";
import type { HomeData, HomeSection } from "@/lib/types";
import { ProductCard, ProductCardSkeleton } from "@/features/storefront/ProductCard";
import { ChevronIcon, PauseIcon, PlayIcon } from "@/components/icons";

/** Home middle area: fetched client-side from /api/home (spec R02); header/footer are SSR. */
export function HomeClient() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    storefrontApi.home().then((r) => alive && setData(r.data)).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [attempt]);

  if (error) {
    return (
      <div role="alert" className="container-page py-16 text-center text-ink-soft">
        <p>İçerik yüklenemedi.</p>
        <button type="button" className="btn btn-primary mt-4" onClick={() => { setError(false); setAttempt((n) => n + 1); }}>Tekrar dene</button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="container-page space-y-8 py-6" aria-busy="true" aria-label="Yükleniyor">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
        <div className="h-72 animate-pulse rounded-2xl bg-white" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>
      </div>
    );
  }
  if (!data.sections.length) return <p className="container-page py-16 text-center text-ink-soft">Henüz yayında içerik yok.</p>;
  // One broken section (bad data, rendering bug) is reported and hidden; the rest of the home page stays.
  return (
    <div className="container-page space-y-10 py-6">
      {data.sections.map((s) => (
        <ErrorBoundary key={s.id} name={`home.section:${s.type}`}>
          <Section s={s} />
        </ErrorBoundary>
      ))}
    </div>
  );
}

function SectionHeading({ id, title, subtitle, moreHref }: { id: string; title: string; subtitle: string | null; moreHref?: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>{subtitle && <p className="eyebrow">{subtitle}</p>}<h2 id={id} className="text-xl font-bold">{title}</h2></div>
      {moreHref && <Link href={moreHref} className="flex-none text-sm font-semibold hover:text-brand">Tümünü gör →</Link>}
    </div>
  );
}

function Section({ s }: { s: HomeSection }) {
  switch (s.type) {
    case "story_strip": return <StoryStrip title={s.title} stories={s.stories} />;
    case "hero_slider": return <HeroSlider slides={s.slides} />;
    case "banner": return <Banner s={s} />;
    case "category_tiles":
      return (
        <section aria-labelledby={`sec-${s.id}`}>
          <SectionHeading id={`sec-${s.id}`} title={s.title} subtitle={s.subtitle} moreHref="/kategoriler" />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {s.categories.map((c) => (
              <li key={c.id}>
                <Link href={c.href} className="group flex items-center gap-3 rounded-2xl border border-line bg-white p-3 transition hover:border-brand hover:shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {c.imageUrl ? <img src={c.imageUrl} alt="" loading="lazy" className="size-14 flex-none rounded-xl bg-ground object-cover" /> : <span className="grid size-14 flex-none place-items-center rounded-xl bg-brand-soft text-lg font-bold text-brand">{c.name.slice(0, 1)}</span>}
                  <span className="font-semibold group-hover:text-brand">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      );
    case "brand_strip":
      return (
        <section aria-labelledby={`sec-${s.id}`}>
          <SectionHeading id={`sec-${s.id}`} title={s.title} subtitle={s.subtitle} moreHref="/markalar" />
          <ul className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
            {s.brands.map((b) => (
              <li key={b.id} className="flex-none">
                <Link href={b.href} className="flex h-20 w-40 items-center justify-center rounded-2xl border border-line bg-white px-4 text-center font-semibold transition hover:border-brand hover:text-brand">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {b.logoUrl ? <img src={b.logoUrl} alt={b.name} loading="lazy" className="max-h-12 max-w-full object-contain" /> : b.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      );
    case "products":
      return (
        <section aria-labelledby={`sec-${s.id}`}>
          <SectionHeading id={`sec-${s.id}`} title={s.title} subtitle={s.subtitle} moreHref={s.moreHref} />
          <div className={s.layout === "grid" ? "grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5" : "no-scrollbar grid auto-cols-[46%] grid-flow-col gap-3 overflow-x-auto sm:auto-cols-[31%] md:auto-cols-[23%] lg:auto-cols-[19%]"}>
            {s.products.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        </section>
      );
  }
}

function Banner({ s }: { s: Extract<HomeSection, { type: "banner" }> }) {
  const body = (
    <div className="relative overflow-hidden rounded-2xl bg-navy text-white">
      <picture className="block">
        {s.mobileImageUrl && <source media="(max-width: 767px)" srcSet={s.mobileImageUrl} />}
        <img src={s.imageUrl} alt={s.alt} loading="lazy" className="h-48 w-full object-cover opacity-80 md:h-64" />
      </picture>
      <div className="absolute inset-0 flex flex-col justify-center gap-2 bg-gradient-to-r from-navy/85 via-navy/40 to-transparent p-6 md:p-10">
        <h2 className="max-w-lg text-2xl font-extrabold md:text-3xl">{s.title}</h2>
        {s.subtitle && <p className="max-w-md text-white/85">{s.subtitle}</p>}
        {s.href && s.ctaLabel && <span className="btn mt-2 w-fit bg-white text-navy">{s.ctaLabel} →</span>}
      </div>
    </div>
  );
  return <section aria-label={s.title}>{s.href ? <Link href={s.href} className="block">{body}</Link> : body}</section>;
}

function StoryStrip({ title, stories }: { title: string; stories: Extract<HomeSection, { type: "story_strip" }>["stories"] }) {
  return (
    <section aria-label={title} className="flex items-center gap-6">
      <div className="hidden w-28 flex-none md:block"><p className="eyebrow">Her gün yeni</p><p className="text-lg font-bold leading-tight">{title}</p></div>
      <ul className="no-scrollbar flex flex-1 gap-5 overflow-x-auto py-1">
        {stories.map((st) => (
          <li key={st.id} className="flex-none text-center">
            <Link href={st.frames[0]?.href ?? `/marka/${st.brandSlug}`} className="group block">
              <span className="mx-auto block h-[72px] w-[72px] rounded-full bg-gradient-to-tr from-brand to-amber-300 p-[3px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={st.coverUrl ?? "/demo/placeholder.svg"} alt="" className="h-full w-full rounded-full border-2 border-white bg-white object-cover" />
              </span>
              <span className="mt-2 block max-w-20 truncate text-xs font-medium group-hover:text-brand">{st.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One hero slider (spec R05). Auto-advance can be paused (WCAG 2.2.2). */
function HeroSlider({ slides }: { slides: Extract<HomeSection, { type: "hero_slider" }>["slides"] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (paused || slides.length < 2) return;
    timer.current = setInterval(() => setI((x) => (x + 1) % slides.length), 6000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [paused, slides.length]);
  const s = slides[i];
  if (!s) return null;
  return (
    <section aria-roledescription="carousel" aria-label="Öne çıkanlar" className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#eef2fb] to-[#dfe7f7]">
      <div className="grid items-center gap-6 p-6 md:grid-cols-2 md:p-10" aria-live={paused ? "polite" : "off"}>
        <div>
          <p className="eyebrow">Yeni sezon seçkisi</p>
          <h1 className="mt-2 text-3xl font-extrabold leading-tight text-navy md:text-5xl">{s.title}</h1>
          {s.subtitle && <p className="mt-3 max-w-md text-ink-soft">{s.subtitle}</p>}
          {s.ctaLabel && s.href && <Link href={s.href} className="btn btn-dark mt-6">{s.ctaLabel} →</Link>}
        </div>
        <picture className="block">
          {s.mobileUrl && <source media="(max-width: 767px)" srcSet={s.mobileUrl} />}
          <img src={s.desktopUrl} alt={s.alt} className="mx-auto max-h-72 w-full rounded-xl object-contain" />
        </picture>
      </div>
      {slides.length > 1 && (
        <div className="absolute bottom-4 left-6 flex items-center gap-2 md:left-10">
          <button className="grid h-8 w-8 place-items-center rounded-full bg-white/80" aria-label="Önceki" onClick={() => setI((x) => (x - 1 + slides.length) % slides.length)}><ChevronIcon dir="left" /></button>
          {slides.map((sl, k) => (
            <button key={sl.id} aria-label={`${k + 1}. slayt`} aria-current={k === i} onClick={() => setI(k)}
              className={`h-1.5 rounded-full transition-all ${k === i ? "w-6 bg-navy" : "w-2 bg-navy/30"}`} />
          ))}
          <button className="grid h-8 w-8 place-items-center rounded-full bg-white/80" aria-label="Sonraki" onClick={() => setI((x) => (x + 1) % slides.length)}><ChevronIcon /></button>
          <button className="grid h-8 w-8 place-items-center rounded-full bg-white/80" aria-label={paused ? "Oynat" : "Duraklat"} onClick={() => setPaused((p) => !p)}>
            {paused ? <PlayIcon /> : <PauseIcon />}
          </button>
        </div>
      )}
    </section>
  );
}
