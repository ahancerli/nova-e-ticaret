"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { HomeData, HomeSection } from "@/lib/types";
import { ProductCard, ProductCardSkeleton } from "./ProductCard";
import { ChevronIcon, PauseIcon, PlayIcon } from "@/components/icons";

/** Home middle area: fetched client-side from /api/home (spec R02); header/footer are SSR. */
export function HomeClient() {
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    api<HomeData>("/api/home").then((r) => alive && setData(r.data)).catch(() => alive && setError(true));
    return () => { alive = false; };
  }, []);

  if (error) return <p role="alert" className="container-page py-16 text-center text-ink-soft">İçerik yüklenemedi. Sayfayı yenileyin.</p>;
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
  return <div className="container-page space-y-10 py-6">{data.sections.map((s) => <Section key={s.id} s={s} />)}</div>;
}

function Section({ s }: { s: HomeSection }) {
  if (s.type === "story_strip") return <StoryStrip title={s.title} stories={s.stories} />;
  if (s.type === "hero_slider") return <HeroSlider slides={s.slides} />;
  return (
    <section aria-labelledby={`sec-${s.id}`}>
      <div className="mb-4 flex items-end justify-between">
        <div><p className="eyebrow">Sana özel vitrin</p><h2 id={`sec-${s.id}`} className="text-xl font-bold">{s.title}</h2></div>
        <Link href="/ara" className="text-sm font-semibold hover:text-brand">Tümünü gör →</Link>
      </div>
      <div className={s.layout === "grid" ? "grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5" : "no-scrollbar grid auto-cols-[46%] grid-flow-col gap-3 overflow-x-auto sm:auto-cols-[31%] md:auto-cols-[23%] lg:auto-cols-[19%]"}>
        {s.products.map((p) => <ProductCard key={p.id} p={p} />)}
      </div>
    </section>
  );
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
