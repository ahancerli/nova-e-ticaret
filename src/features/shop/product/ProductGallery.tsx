"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, Play } from "lucide-react";
import { GalleryLightbox } from "./GalleryLightbox";

export type GalleryMedia = { url: string; alt: string; kind: "image" | "video" };

/** How far the picture is magnified under the mouse. */
const HOVER_SCALE = 2.4;
const SWIPE_PX = 48;
const TINT = "bg-[color-mix(in_oklab,var(--dept,var(--color-brand))_12%,white)]";

/**
 * Product gallery: the picture is the first thing to inspect, so zooming needs no extra step.
 *  - mouse: moving over the picture magnifies the spot under the cursor in place; a click opens the full-screen viewer;
 *  - touch: swipe between items, tap to open the viewer (pinch / double tap there);
 *  - videos play in place with the browser's controls and can be opened in the viewer too.
 * The hover magnifier writes its transform straight to the element, so moving the mouse never re-renders the page.
 * Mount with a `key` per photo set (colour): a new set starts at its first item.
 */
export function ProductGallery({ media, productName }: { media: GalleryMedia[]; productName: string }) {
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const picture = useRef<HTMLImageElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const count = media.length;
  const index = Math.min(active, Math.max(0, count - 1));
  const item = media[index];
  const go = (dir: -1 | 1) => setActive((index + dir + count) % count);

  const magnify = (e: React.PointerEvent<HTMLButtonElement>) => {
    const img = picture.current;
    if (e.pointerType !== "mouse" || !img) return;
    const box = e.currentTarget.getBoundingClientRect();
    img.style.transformOrigin = `${((e.clientX - box.left) / box.width) * 100}% ${((e.clientY - box.top) / box.height) * 100}%`;
    img.style.transform = `scale(${HOVER_SCALE})`;
  };
  const rest = () => { if (picture.current) picture.current.style.transform = ""; };

  if (!item) return <div className={`aspect-square rounded-[28px] ${TINT}`} />;
  const label = (m: GalleryMedia, i: number) => (m.kind === "video" ? `Video ${i + 1}` : `Görsel ${i + 1}`);

  return (
    // md+: the thumbnail rail is pinned beside the stage and takes exactly its height (it scrolls when there are many)
    <div className={count > 1 ? "relative md:pl-[5.5rem]" : "relative"}>
      <div className={`group relative aspect-square overflow-hidden rounded-[28px] ${item.kind === "video" ? "bg-ink" : TINT}`}
        onTouchStart={(e) => { const t = e.touches[0]; touch.current = t ? { x: t.clientX, y: t.clientY } : null; }}
        onTouchEnd={(e) => {
          const from = touch.current;
          const t = e.changedTouches[0];
          touch.current = null;
          if (!from || !t || count < 2) return;
          const dx = t.clientX - from.x;
          if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(t.clientY - from.y) * 1.5) go(dx < 0 ? 1 : -1);
        }}>
        {item.kind === "video" ? (
          <video key={item.url} src={`${item.url}#t=0.1`} controls playsInline preload="metadata" aria-label={item.alt || `${productName} videosu`} className="h-full w-full object-contain" />
        ) : (
          <button type="button" onClick={() => setOpen(true)} onPointerMove={magnify} onPointerLeave={rest} aria-label="Görseli tam ekran aç ve yakınlaştır"
            className="block h-full w-full cursor-zoom-in overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={picture} key={item.url} src={item.url} alt={item.alt || productName} draggable={false} fetchPriority={index === 0 ? "high" : undefined}
              className="h-full w-full object-contain mix-blend-multiply transition-transform duration-150 ease-out will-change-transform motion-reduce:transition-none" />
          </button>
        )}

        {count > 1 && (
          <>
            <button type="button" aria-label="Önceki" onClick={() => go(-1)}
              className="absolute left-3 top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-ink opacity-0 shadow-sm transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 md:grid"><ChevronLeft className="size-5" /></button>
            <button type="button" aria-label="Sonraki" onClick={() => go(1)}
              className="absolute right-3 top-1/2 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-white/95 text-ink opacity-0 shadow-sm transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 md:grid"><ChevronRight className="size-5" /></button>
            <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold tabular-nums text-ink md:hidden">{index + 1} / {count}</span>
          </>
        )}
        {/* the video keeps its bottom edge free for the player's own controls */}
        <button type="button" onClick={() => setOpen(true)} aria-label="Tam ekran aç"
          className={`absolute right-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/95 px-3 text-xs font-semibold text-ink shadow-sm transition hover:bg-white ${item.kind === "video" ? "top-3" : "bottom-3"}`}>
          <Expand className="size-4" aria-hidden />{item.kind === "video" ? "Tam ekran" : "Büyüt"}
        </button>
      </div>

      {count > 1 && (
        <ul className="no-scrollbar mt-3 flex gap-2 overflow-x-auto md:absolute md:inset-y-0 md:left-0 md:mt-0 md:w-[4.75rem] md:flex-col md:overflow-y-auto md:overflow-x-hidden">
          {media.map((m, i) => (
            <li key={m.url + i} className="flex-none">
              <button type="button" onClick={() => setActive(i)} onMouseEnter={() => setActive(i)} aria-label={label(m, i)} aria-current={i === index}
                className={`relative block size-[4.5rem] overflow-hidden rounded-2xl border-2 ${TINT} ${i === index ? "border-ink" : "border-transparent"}`}>
                {m.kind === "video" ? (
                  <>
                    <video src={`${m.url}#t=0.1`} muted playsInline preload="metadata" tabIndex={-1} className="h-full w-full object-cover" />
                    <span className="absolute inset-0 grid place-items-center bg-ink/25"><span className="grid size-7 place-items-center rounded-full bg-white/95"><Play className="size-3.5 translate-x-px fill-ink text-ink" /></span></span>
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" loading="lazy" className="h-full w-full object-contain mix-blend-multiply" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && <GalleryLightbox media={media} index={index} productName={productName} onIndex={setActive} onClose={() => setOpen(false)} />}
    </div>
  );
}
