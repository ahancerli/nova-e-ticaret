"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ExternalLink, Laptop, RefreshCw, RotateCw, Smartphone, Tablet, X } from "lucide-react";
import { Portal } from "@/components/ui/Portal";

const DEVICES = {
  phone: { label: "Telefon", icon: Smartphone, w: 390, h: 844, frame: "rounded-[2.75rem] border-[12px] border-slate-900 shadow-2xl" },
  tablet: { label: "Tablet", icon: Tablet, w: 820, h: 1180, frame: "rounded-[2rem] border-[14px] border-slate-900 shadow-2xl" },
  desktop: { label: "Bilgisayar", icon: Laptop, w: 1440, h: 900, frame: "rounded-xl border border-slate-300 shadow-2xl" },
} as const;
type Device = keyof typeof DEVICES;

const PAGES = [
  { path: "/", label: "Ana sayfa" },
  { path: "/kampanyalar", label: "Fırsatlar" },
  { path: "/kategoriler", label: "Kategoriler" },
  { path: "/markalar", label: "Markalar" },
];

/**
 * Vitrin › Önizleme: the live storefront in a phone / tablet / desktop frame. The page is rendered at the device's real
 * width (so the storefront's breakpoints apply) and scaled down to fit the screen. Shows saved changes — "Yenile"
 * after saving. Same-origin framing is allowed only for storefront pages (src/proxy.ts, next.config.ts).
 */
export function DevicePreview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [device, setDevice] = useState<Device>("phone");
  const [landscape, setLandscape] = useState(false);
  const [path, setPath] = useState("/");
  const [custom, setCustom] = useState("");
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const stage = useRef<HTMLDivElement>(null);

  const d = DEVICES[device];
  const rotated = landscape && device !== "desktop";
  const w = rotated ? d.h : d.w, h = rotated ? d.w : d.h;
  // the frame's own border adds to the drawn size
  const bezel = device === "phone" ? 24 : device === "tablet" ? 28 : 2;
  const chrome = device === "desktop" ? 40 : 0;
  const statusBar = device === "phone" && !rotated;

  useLayoutEffect(() => {
    if (!open) return;
    const el = stage.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth - 48) / (w + bezel), (el.clientHeight - 48) / (h + bezel + chrome)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, w, h, bezel, chrome]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);

  if (!open) return null;
  const go = (p: string) => { setPath(p); setLoading(true); };
  const src = `${path}${path.includes("?") ? "&" : "?"}onizleme=${nonce}`;

  return (
    <Portal>
      <div role="dialog" aria-modal="true" aria-label="Vitrin önizlemesi" className="fixed inset-0 z-[80] flex flex-col bg-slate-900/80 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-slate-950/90 px-3 py-2.5 text-white sm:px-5">
          <p className="mr-2 text-sm font-semibold">Önizleme</p>
          <div role="radiogroup" aria-label="Cihaz" className="inline-flex rounded-lg bg-white/10 p-0.5">
            {(Object.keys(DEVICES) as Device[]).map((k) => {
              const Icon = DEVICES[k].icon;
              return (
                <button key={k} type="button" role="radio" aria-checked={device === k} onClick={() => setDevice(k)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition ${device === k ? "bg-white text-slate-900 shadow" : "text-white/70 hover:text-white"}`}>
                  <Icon className="size-4" /><span className="hidden sm:inline">{DEVICES[k].label}</span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => setLandscape((v) => !v)} disabled={device === "desktop"} aria-pressed={landscape} title="Yan çevir"
            className="grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10 disabled:opacity-30"><RotateCw className="size-4" /></button>
          <span className="mx-1 hidden h-6 w-px bg-white/15 md:block" />
          <select aria-label="Sayfa" value={PAGES.some((p) => p.path === path) ? path : ""} onChange={(e) => e.target.value && go(e.target.value)}
            className="h-9 rounded-lg border border-white/15 bg-white/10 px-2 text-sm text-white [&>option]:text-slate-900">
            {PAGES.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}
            {!PAGES.some((p) => p.path === path) ? <option value="">{path}</option> : null}
          </select>
          <form className="hidden items-center md:flex" onSubmit={(e) => { e.preventDefault(); const p = custom.trim(); if (p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/admin")) go(p); }}>
            <input aria-label="Sayfa yolu" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="/urun/… veya /kategori/…" maxLength={200}
              className="h-9 w-56 rounded-lg border border-white/15 bg-white/10 px-3 font-mono text-xs text-white placeholder:text-white/40" />
          </form>
          <span className="ml-auto flex items-center gap-1">
            <span className="hidden text-xs tabular-nums text-white/50 lg:inline">{w} × {h} · %{Math.round(scale * 100)}</span>
            <button type="button" onClick={() => { setNonce((n) => n + 1); setLoading(true); }} title="Yenile (kaydettikten sonra)" className="grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></button>
            <a href={path} target="_blank" rel="noreferrer" title="Yeni sekmede aç" className="grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10"><ExternalLink className="size-4" /></a>
            <button type="button" onClick={onClose} aria-label="Önizlemeyi kapat" className="grid size-9 place-items-center rounded-lg text-white/80 hover:bg-white/10"><X className="size-5" /></button>
          </span>
        </div>

        <div ref={stage} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <div style={{ width: (w + bezel) * scale, height: (h + bezel + chrome) * scale }} className="transition-[width,height] duration-300 ease-out">
            <div style={{ width: w + bezel, transform: `scale(${scale})`, transformOrigin: "top left" }} className={`overflow-hidden bg-white ${d.frame}`}>
              {device === "desktop" ? (
                <div className="flex h-10 items-center gap-2 border-b border-slate-200 bg-slate-100 px-4">
                  <span className="size-3 rounded-full bg-red-400" /><span className="size-3 rounded-full bg-amber-400" /><span className="size-3 rounded-full bg-emerald-400" />
                  <span className="ml-4 flex-1 truncate rounded-md bg-white px-3 py-1 text-xs text-slate-500">{typeof window !== "undefined" ? window.location.host : ""}{path}</span>
                </div>
              ) : null}
              <div className="relative" style={{ width: w, height: h }}>
                {/* a phone's status bar (with the camera cut-out) sits above the page, as on a real device */}
                {statusBar ? (
                  <div aria-hidden className="flex h-7 items-center justify-between bg-white px-6 text-[11px] font-semibold text-slate-900">
                    <span>9:41</span><span className="h-5 w-24 rounded-full bg-slate-900" /><span>●●● ▮</span>
                  </div>
                ) : null}
                {/* sandbox: scripts and same-origin reads for the storefront app, no top navigation / popups out of the frame */}
                <iframe key={`${src}-${device}-${rotated}`} src={src} title={`${DEVICES[device].label} önizlemesi`} width={w} height={statusBar ? h - 28 : h} onLoad={() => setLoading(false)}
                  sandbox="allow-scripts allow-same-origin allow-forms" className="block border-0 bg-white" />
                {loading ? <div className="absolute inset-0 grid place-items-center bg-white/70"><RefreshCw className="size-6 animate-spin text-slate-400" /></div> : null}
              </div>
            </div>
          </div>
          <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-xs text-white/80">Kaydedilmiş vitrin gösterilir · değişiklikten sonra ↻ Yenile</p>
        </div>
      </div>
    </Portal>
  );
}
