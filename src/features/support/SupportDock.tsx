"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Maximize2, MessagesSquare, X } from "lucide-react";
import { SupportConsole } from "./SupportConsole";
import { useSupportInbox } from "./useSupportInbox";

const PAGE = "/admin/canli-destek";

/** Panel chrome: the dock stays mounted on every admin page except the support page, which has its own console. */
export function SupportDock() {
  const pathname = usePathname();
  if (pathname.startsWith(PAGE)) return null;
  return <Dock />;
}

/**
 * Floating button (bottom right) with the total unread count, opening the console in a panel. Holding the stream
 * here keeps the agent online for the shop on any admin page; the tab title carries the count while in background.
 */
function Dock() {
  const inbox = useSupportInbox();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const unread = inbox.totalUnread;

  useEffect(() => {
    const base = document.title.replace(/^\(\d+\+?\) /, "");
    document.title = unread ? `(${unread > 99 ? "99+" : unread}) ${base}` : base;
  }, [unread]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {open && (
        <div role="dialog" aria-label="Canlı destek"
          className="fixed inset-0 z-50 flex animate-scale-in flex-col overflow-hidden bg-white sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(620px,calc(100dvh-8rem))] sm:w-[min(860px,calc(100vw-3rem))] sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-2xl sm:[transform-origin:bottom_right]">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
            <MessagesSquare className="size-4 text-[#7367f0]" aria-hidden />
            <p className="flex-1 text-sm font-semibold text-slate-800">Canlı destek</p>
            <Link href={PAGE} onClick={() => setOpen(false)} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
              <Maximize2 className="size-3.5" aria-hidden /> Tam ekran
            </Link>
            <button type="button" onClick={() => setOpen(false)} aria-label="Kapat" className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1"><SupportConsole inbox={inbox} compact /></div>
        </div>
      )}
      <button ref={buttonRef} type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        aria-label={unread ? `Canlı destek, ${unread} okunmamış mesaj` : "Canlı destek"}
        className={`fixed bottom-6 right-6 z-40 grid size-14 place-items-center rounded-full bg-[#7367f0] text-white shadow-[0_12px_30px_-10px_rgb(115_103_240/0.8)] transition-transform hover:-translate-y-0.5 ${open ? "max-sm:hidden" : ""}`}>
        {open ? <X className="size-6" aria-hidden /> : <MessagesSquare className="size-6" aria-hidden />}
        {unread > 0 && (
          <span key={unread} className="absolute -right-1 -top-1 grid h-6 min-w-6 animate-bump place-items-center rounded-full bg-rose-500 px-1.5 text-xs font-bold ring-2 ring-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </>
  );
}
