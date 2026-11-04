"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { HomeSection } from "@/lib/types";
import { ChevronIcon, PauseIcon, PlayIcon } from "@/components/icons";

type Slide = Extract<HomeSection, { type: "hero_slider" }>["slides"][number];

const INTERVAL_MS = 6000;

/**
 * Full-bleed hero slider (spec R05). The first slide is in the server HTML (LCP image, eager); the island
 * adds auto-advance, which pauses on hover/focus and via the pause button (WCAG 2.2.2).
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
      <div className="absolute inset-x-3 bottom-3 max-w-md rounded-2xl bg-white/90 p-4 shadow-lg backdrop-blur sm:bottom-6 sm:left-6 sm:p-5">
        <h2 className="text-lg font-extrabold leading-tight text-ink sm:text-2xl">{s.title}</h2>
        {s.subtitle && <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{s.subtitle}</p>}
        {s.ctaLabel && s.href && <span className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-brand">{s.ctaLabel} <ChevronIcon className="size-4" /></span>}
      </div>
    </>
  );

  return (
    <section aria-roledescription="carousel" aria-label="Öne çıkanlar" className="relative overflow-hidden rounded-2xl bg-ground"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <div aria-roledescription="slide" aria-label={`${i + 1} / ${n}: ${s.title}`} aria-live={paused ? "polite" : "off"}>
        {s.href ? <Link href={s.href} className="block">{body}</Link> : body}
      </div>
      {n > 1 && (
        <>
          <button type="button" className={`${ctrl} absolute left-3 top-1/2 -translate-y-1/2`} aria-label="Önceki slayt" onClick={() => go(-1)}><ChevronIcon dir="left" /></button>
          <button type="button" className={`${ctrl} absolute right-3 top-1/2 -translate-y-1/2`} aria-label="Sonraki slayt" onClick={() => go(1)}><ChevronIcon /></button>
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
