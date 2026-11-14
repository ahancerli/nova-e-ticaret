"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { HomeSection } from "@/lib/types";
import { ChevronIcon, PauseIcon, PlayIcon } from "@/components/icons";

type Slide = Extract<HomeSection, { type: "hero_slider" }>["slides"][number];

const INTERVAL_MS = 6000;

/**
 * Full-bleed hero slider (spec R05). The first slide is in the server HTML (LCP image, eager); the island
 * adds auto-advance, which pauses on hover/focus and via the pause button (WCAG 2.2.2). On phones the caption
 * sits under the image instead of covering it.
 */
export function HeroSlider({ slides }: { slides: Slide[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const n = slides.length;

  useEffect(() => {
    if (paused || hover || n < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), INTERVAL_MS);
    return () => clearInterval(t);
  }, [paused, hover, n]);

  const s = slides[i];
  if (!s) return null;
  const go = (d: number) => setI((x) => (x + d + n) % n);
  const ctrl = "grid size-10 place-items-center rounded-full bg-white/90 text-ink shadow-md transition hover:bg-white hover:text-brand";

  const body = (
    <>
      <picture className="block">
        {s.mobileUrl && <source media="(max-width: 767px)" srcSet={s.mobileUrl} />}
        <img src={s.desktopUrl} alt={s.alt} loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"}
          className="aspect-[4/3] w-full object-cover sm:aspect-[5/2]" />
      </picture>
      <div className="bg-white p-4 sm:absolute sm:bottom-6 sm:left-6 sm:max-w-md sm:rounded-2xl sm:p-6 sm:shadow-[0_12px_40px_rgb(25_22_64/0.18)]">
        <h2 className="font-display text-xl font-extrabold leading-[1.1] tracking-tight text-ink sm:text-[28px]">{s.title}</h2>
        {s.subtitle && <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">{s.subtitle}</p>}
        {s.ctaLabel && s.href && <span className="mt-4 inline-flex h-10 items-center gap-1 rounded-full bg-brand pl-5 pr-4 text-sm font-bold text-white">{s.ctaLabel} <ChevronIcon className="size-4" /></span>}
      </div>
    </>
  );

  return (
    <section aria-roledescription="carousel" aria-label="Öne çıkanlar" className="relative overflow-hidden rounded-3xl border border-line bg-ground sm:border-0"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <div aria-roledescription="slide" aria-label={`${i + 1} / ${n}: ${s.title}`} aria-live={paused ? "polite" : "off"}>
        {s.href ? <Link href={s.href} className="block">{body}</Link> : body}
      </div>
      {n > 1 && (
        <>
          <button type="button" className={`${ctrl} absolute left-3 top-[calc((100vw-2rem)*0.375)] -translate-y-1/2 sm:top-1/2`} aria-label="Önceki slayt" onClick={() => go(-1)}><ChevronIcon dir="left" /></button>
          <button type="button" className={`${ctrl} absolute right-3 top-[calc((100vw-2rem)*0.375)] -translate-y-1/2 sm:top-1/2`} aria-label="Sonraki slayt" onClick={() => go(1)}><ChevronIcon /></button>
          <div className="absolute right-4 top-4 flex items-center gap-2 sm:bottom-6 sm:right-6 sm:top-auto">
            <span className="rounded-full bg-ink/70 px-2.5 py-1 text-xs font-semibold tabular-nums text-white">{i + 1} / {n}</span>
            <button type="button" className="grid size-8 place-items-center rounded-full bg-ink/70 text-white" aria-label={paused ? "Otomatik geçişi başlat" : "Otomatik geçişi durdur"} onClick={() => setPaused((p) => !p)}>
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
