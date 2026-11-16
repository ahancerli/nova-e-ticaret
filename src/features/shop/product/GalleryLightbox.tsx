"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, X, ZoomIn, ZoomOut } from "lucide-react";
import { Portal } from "@/components/ui/Portal";
import type { GalleryMedia } from "./ProductGallery";

const MAX_SCALE = 4;
const STEP_SCALE = 2.5;
const SWIPE_PX = 56;
const DOUBLE_TAP_MS = 300;

type Point = { x: number; y: number };
type View = { scale: number; x: number; y: number };
const REST: View = { scale: 1, x: 0, y: 0 };

/**
 * Pan & zoom for one element inside a fixed frame. The transform is written straight to the element (no render per
 * pointer move); React state only mirrors whether the picture is zoomed, for the buttons and the cursor.
 * Coordinates are relative to the frame's centre, so "keep the point under the finger still while scaling" is
 * `t' = p − (p − t) · s'/s`, and the pan limit is half of what the scaled picture overflows the frame by.
 */
function usePanZoom(onSwipe: (dir: -1 | 1) => void, onDismiss: () => void) {
  const frame = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLDivElement>(null);
  const view = useRef<View>(REST);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; moved: boolean; pinch: { distance: number; scale: number } | null } | null>(null);
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const apply = useCallback((next: View, animate: boolean) => {
    const box = frame.current?.getBoundingClientRect();
    const scale = Math.min(MAX_SCALE, Math.max(1, next.scale));
    const limitX = box ? (box.width * (scale - 1)) / 2 : 0;
    const limitY = box ? (box.height * (scale - 1)) / 2 : 0;
    const v = { scale, x: Math.min(limitX, Math.max(-limitX, next.x)), y: Math.min(limitY, Math.max(-limitY, next.y)) };
    view.current = v;
    if (target.current) {
      target.current.style.transition = animate ? "transform 220ms cubic-bezier(.2,.7,.2,1)" : "none";
      target.current.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.scale})`;
    }
    setZoomed(v.scale > 1.01);
  }, []);

  /** Point in frame-centre coordinates. */
  const local = (clientX: number, clientY: number): Point => {
    const box = frame.current!.getBoundingClientRect();
    return { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 };
  };
  const zoomAt = useCallback((p: Point, scale: number, animate: boolean) => {
    const cur = view.current;
    const s = Math.min(MAX_SCALE, Math.max(1, scale));
    const k = s / cur.scale;
    apply({ scale: s, x: p.x - (p.x - cur.x) * k, y: p.y - (p.y - cur.y) * k }, animate);
  }, [apply]);

  const reset = useCallback((animate = false) => apply(REST, animate), [apply]);
  const step = useCallback((dir: 1 | -1) => zoomAt({ x: 0, y: 0 }, dir > 0 ? Math.max(STEP_SCALE, view.current.scale * 1.5) : view.current.scale / 1.5, true), [zoomAt]);

  // Wheel must be a non-passive listener to stop the page from scrolling / the browser from zooming the whole page.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(local(e.clientX, e.clientY), view.current.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...pointers.current.values()];
      gesture.current = {
        start: { x: e.clientX, y: e.clientY }, moved: false,
        pinch: pts.length === 2 ? { distance: Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y), scale: view.current.scale } : null,
      };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const prev = pointers.current.get(e.pointerId);
      const g = gesture.current;
      if (!prev || !g) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...pointers.current.values()];
      if (pts.length === 2 && g.pinch) {
        const distance = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        g.moved = true;
        zoomAt(local((pts[0]!.x + pts[1]!.x) / 2, (pts[0]!.y + pts[1]!.y) / 2), g.pinch.scale * (distance / g.pinch.distance), false);
        // the pinch reference follows, so the next move scales from the current state
        g.pinch = { distance, scale: view.current.scale };
        return;
      }
      if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > 6) g.moved = true;
      if (view.current.scale > 1.01) apply({ ...view.current, x: view.current.x + e.clientX - prev.x, y: view.current.y + e.clientY - prev.y }, false);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const g = gesture.current;
      pointers.current.delete(e.pointerId);
      if (!g || pointers.current.size > 0) {
        // one finger of a pinch lifted: the other continues as a pan
        if (g) g.pinch = null;
        return;
      }
      gesture.current = null;
      const dx = e.clientX - g.start.x;
      const dy = e.clientY - g.start.y;
      if (view.current.scale <= 1.01 && g.moved && e.pointerType !== "mouse") {
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) return onSwipe(dx < 0 ? 1 : -1);
        if (dy > SWIPE_PX * 1.6 && Math.abs(dy) > Math.abs(dx) * 1.5) return onDismiss();
      }
      if (g.moved) return;
      // tap / click: the second one within the window toggles the zoom at that point
      const now = e.timeStamp;
      const tap = lastTap.current;
      if (tap && now - tap.at < DOUBLE_TAP_MS && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 32) {
        lastTap.current = null;
        if (view.current.scale > 1.01) reset(true);
        else zoomAt(local(e.clientX, e.clientY), STEP_SCALE, true);
      } else if (e.pointerType === "mouse") {
        // with a mouse one click is enough
        if (view.current.scale > 1.01) reset(true);
        else zoomAt(local(e.clientX, e.clientY), STEP_SCALE, true);
      } else {
        lastTap.current = { at: now, x: e.clientX, y: e.clientY };
      }
    },
    onPointerCancel: (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size === 0) gesture.current = null;
    },
  };

  return { frame, target, handlers, zoomed, reset, step };
}

/**
 * Full-screen viewer of the product gallery. Images: wheel / pinch / double tap / click to zoom up to 4×, drag to
 * pan; videos play with the browser's controls. Arrow keys and swipes move between items, Esc (or a swipe down)
 * closes. A modal dialog: focus stays inside, the page behind does not scroll, focus returns to the opener.
 */
export function GalleryLightbox({ media, index, productName, onIndex, onClose }: {
  media: GalleryMedia[];
  index: number;
  productName: string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const count = media.length;
  const item = media[index] ?? media[0]!;
  // swipes only fire while unzoomed, so the next picture already starts at rest
  const swipe = useCallback((dir: -1 | 1) => { if (count > 1) onIndex((index + dir + count) % count); }, [count, index, onIndex]);
  const { frame, target, handlers, zoomed, reset, step } = usePanZoom(swipe, onClose);
  /** Every other way of changing the picture drops the zoom first: a new picture starts unzoomed. */
  const select = (i: number) => { reset(false); onIndex(i); };
  const go = (dir: -1 | 1) => { if (count > 1) select((index + dir + count) % count); };

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    closeBtn.current?.focus();
    return () => {
      root.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else if (item.kind === "image" && (e.key === "+" || e.key === "=")) step(1);
    else if (item.kind === "image" && e.key === "-") step(-1);
    else if (e.key === "0") reset(true);
    else if (e.key === "Tab") {
      const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not([disabled]), video[controls]") ?? [])];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  };

  const bar = "grid size-11 place-items-center rounded-full text-ink transition hover:bg-ground disabled:opacity-35 disabled:hover:bg-transparent";
  return (
    <Portal>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={`${productName} görselleri`} onKeyDown={onKeyDown}
        className="fixed inset-0 z-[120] flex flex-col bg-white motion-safe:animate-fade-in">
        <div className="flex h-14 flex-none items-center justify-between gap-2 border-b border-line px-2 sm:px-4">
          <p className="min-w-0 truncate pl-2 text-sm font-semibold text-ink" aria-live="polite">
            <span className="tabular-nums">{index + 1} / {count}</span><span className="ml-3 hidden font-normal text-ink-soft sm:inline">{productName}</span>
          </p>
          <div className="flex items-center">
            {item.kind === "image" && (
              <>
                <button type="button" className={bar} aria-label="Uzaklaştır" disabled={!zoomed} onClick={() => step(-1)}><ZoomOut className="size-5" /></button>
                <button type="button" className={bar} aria-label="Yakınlaştır" onClick={() => step(1)}><ZoomIn className="size-5" /></button>
              </>
            )}
            <button ref={closeBtn} type="button" className={bar} aria-label="Kapat" onClick={onClose}><X className="size-5" /></button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          {item.kind === "video" ? (
            <div className="grid h-full place-items-center bg-ink p-2 sm:p-6">
              <video key={item.url} src={item.url} controls autoPlay playsInline preload="metadata" aria-label={item.alt || `${productName} videosu`} className="max-h-full max-w-full rounded-xl" />
            </div>
          ) : (
            <div ref={frame} {...handlers} className={`h-full touch-none select-none overflow-hidden ${zoomed ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"}`}>
              <div ref={target} className="h-full w-full will-change-transform">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img key={item.url} src={item.url} alt={item.alt || productName} draggable={false} className="h-full w-full object-contain p-2 sm:p-6" />
              </div>
            </div>
          )}
          {count > 1 && (
            <>
              <button type="button" aria-label="Önceki" onClick={() => go(-1)}
                className="absolute left-3 top-1/2 hidden size-12 -translate-y-1/2 place-items-center rounded-full border border-line bg-white/95 text-ink shadow-sm transition hover:bg-ground md:grid"><ChevronLeft className="size-6" /></button>
              <button type="button" aria-label="Sonraki" onClick={() => go(1)}
                className="absolute right-3 top-1/2 hidden size-12 -translate-y-1/2 place-items-center rounded-full border border-line bg-white/95 text-ink shadow-sm transition hover:bg-ground md:grid"><ChevronRight className="size-6" /></button>
            </>
          )}
        </div>

        {count > 1 && (
          <div className="no-scrollbar flex flex-none justify-start gap-2 overflow-x-auto border-t border-line px-3 py-3 sm:justify-center">
            {media.map((m, i) => (
              <button key={m.url + i} type="button" onClick={() => select(i)} aria-label={m.kind === "video" ? `Video ${i + 1}` : `Görsel ${i + 1}`} aria-current={i === index}
                className={`relative size-14 flex-none overflow-hidden rounded-xl border-2 bg-ground sm:size-16 ${i === index ? "border-ink" : "border-transparent opacity-70 hover:opacity-100"}`}>
                {m.kind === "video" ? (
                  <>
                    <video src={`${m.url}#t=0.1`} muted playsInline preload="metadata" tabIndex={-1} className="h-full w-full object-cover" />
                    <span className="absolute inset-0 grid place-items-center bg-ink/25"><Play className="size-5 fill-white text-white" /></span>
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" className="h-full w-full object-contain" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </Portal>
  );
}
