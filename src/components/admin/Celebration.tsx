"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CELEBRATE_EVENT } from "@/lib/toast";
import { Portal } from "@/components/ui/Portal";

/** The shop's department spectrum (globals.css): the panel celebrates in the brand's own colours. */
const COLORS = ["var(--color-dept-1)", "var(--color-dept-2)", "var(--color-dept-3)", "var(--color-dept-4)", "var(--color-dept-5)", "var(--color-dept-6)"];
const SHARDS = [0, 1, 2, 3, 4, 5, 6, 7];
const RISE = 1.05;
const MIN_GAP_MS = 1400;

type Balloon = { id: number; left: number; size: number; color: string; delay: number; lift: number; sway: number };
type Burst = { id: number; balloons: Balloon[] };

function makeBurst(id: number): Burst {
  const count = 7;
  const balloons = Array.from({ length: count }, (_, i): Balloon => ({
    id: i,
    // spread over the right half, where the success toast appears
    left: 46 + (i / (count - 1)) * 46 + (Math.random() * 6 - 3),
    size: 34 + Math.random() * 18,
    color: COLORS[(id + i) % COLORS.length] ?? "#7367f0",
    delay: i * 0.06 + Math.random() * 0.08,
    lift: 46 + Math.random() * 30,
    sway: Math.random() * 40 - 20,
  }));
  return { id, balloons };
}

/**
 * Success moment of the panel: a handful of balloons rise from the bottom edge and pop. Fired by
 * `notify.success` (window event), mounted once in the admin shell. Purely decorative: no pointer events,
 * hidden from assistive tech, skipped with prefers-reduced-motion, and never stacked (one burst at a time).
 */
export function Celebration() {
  const reduced = useReducedMotion();
  const [bursts, setBursts] = useState<Burst[]>([]);

  useEffect(() => {
    if (reduced) return;
    let last = 0;
    let seq = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onCelebrate = () => {
      const now = Date.now();
      if (now - last < MIN_GAP_MS) return;
      last = now;
      const burst = makeBurst(++seq);
      setBursts((b) => [...b, burst]);
      const t = setTimeout(() => {
        timers.delete(t);
        setBursts((b) => b.filter((x) => x.id !== burst.id));
      }, 2400);
      timers.add(t);
    };
    window.addEventListener(CELEBRATE_EVENT, onCelebrate);
    return () => {
      window.removeEventListener(CELEBRATE_EVENT, onCelebrate);
      for (const t of timers) clearTimeout(t);
    };
  }, [reduced]);

  if (reduced) return null;
  return (
    <Portal>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[90] overflow-hidden">
        <AnimatePresence>
          {bursts.map((burst) => burst.balloons.map((b) => <BalloonView key={`${burst.id}-${b.id}`} b={b} />))}
        </AnimatePresence>
      </div>
    </Portal>
  );
}

function BalloonView({ b }: { b: Balloon }) {
  const popAt = b.delay + RISE;
  return (
    <motion.div
      className="absolute bottom-0"
      style={{ left: `${b.left}%`, width: b.size, height: b.size * 1.22 }}
      initial={{ y: "110%", x: 0, rotate: b.sway / 4 }}
      animate={{ y: `-${b.lift}vh`, x: b.sway, rotate: -b.sway / 5 }}
      exit={{ opacity: 0 }}
      transition={{ duration: RISE, delay: b.delay, ease: [0.2, 0.7, 0.3, 1] }}
    >
      {/* body: swells for a beat, then is gone in one frame */}
      <motion.div
        className="absolute inset-0 rounded-[50%_50%_50%_50%/45%_45%_55%_55%]"
        style={{ backgroundColor: b.color, boxShadow: "inset -6px -8px 0 rgb(0 0 0 / 0.12), inset 5px 6px 0 rgb(255 255 255 / 0.28)" }}
        animate={{ scale: [1, 1, 1.22, 0], opacity: [1, 1, 1, 0] }}
        transition={{ duration: popAt + 0.14, times: [0, popAt / (popAt + 0.14), 0.97, 1], ease: "linear" }}
      >
        <span className="absolute left-1/2 top-full size-2 -translate-x-1/2 -translate-y-1/2 rotate-45" style={{ backgroundColor: b.color }} />
      </motion.div>
      <motion.span
        className="absolute left-1/2 top-full h-10 w-px origin-top bg-slate-400/60"
        animate={{ opacity: [1, 1, 0], scaleY: [1, 1, 0.4] }}
        transition={{ duration: popAt + 0.1, times: [0, 0.95, 1] }}
      />
      {/* pop: shards fly out from the centre */}
      {SHARDS.map((i) => {
        const angle = (i / SHARDS.length) * Math.PI * 2;
        const reach = b.size * 1.15;
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 h-1.5 w-3 rounded-full"
            style={{ backgroundColor: b.color, rotate: `${(angle * 180) / Math.PI}deg` }}
            initial={{ x: "-50%", y: "-50%", opacity: 0, scale: 0.4 }}
            animate={{ x: `calc(-50% + ${Math.cos(angle) * reach}px)`, y: `calc(-50% + ${Math.sin(angle) * reach + 14}px)`, opacity: [0, 1, 0], scale: [0.4, 1, 0.6] }}
            transition={{ duration: 0.55, delay: popAt + 0.1, ease: [0.16, 1, 0.3, 1] }}
          />
        );
      })}
    </motion.div>
  );
}
