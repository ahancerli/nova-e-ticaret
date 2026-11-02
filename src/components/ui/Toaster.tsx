"use client";

import { Toaster as Sonner } from "sonner";
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";

const chip = "grid size-8 flex-none place-items-center rounded-full";

/**
 * App-wide toast host (Sonner engine, nova styling). Mounted once in the root layout.
 * Stacking, swipe-to-dismiss, hover-to-expand, pause-on-hover and the aria-live region come from Sonner.
 * Always call through `@/lib/toast`, never import "sonner" in feature code.
 */
export function Toaster() {
  return (
    <Sonner
      position="top-right"
      gap={10}
      offset={20}
      mobileOffset={12}
      visibleToasts={4}
      closeButton
      containerAriaLabel="Bildirimler"
      icons={{
        success: <span className={`${chip} bg-emerald-50 text-emerald-600`}><CircleCheck className="h-[18px] w-[18px]" /></span>,
        error: <span className={`${chip} bg-red-50 text-red-600`}><CircleAlert className="h-[18px] w-[18px]" /></span>,
        warning: <span className={`${chip} bg-amber-50 text-amber-600`}><TriangleAlert className="h-[18px] w-[18px]" /></span>,
        info: <span className={`${chip} bg-indigo-50 text-[#7367f0]`}><Info className="h-[18px] w-[18px]" /></span>,
        loading: <span className={`${chip} bg-slate-100 text-slate-500`}><LoaderCircle className="h-[18px] w-[18px] animate-spin" /></span>,
        close: <X className="h-3.5 w-3.5" />,
      }}
      toastOptions={{
        unstyled: true,
        duration: 4500,
        classNames: {
          toast:
            "group pointer-events-auto flex w-full items-start gap-3 rounded-2xl border border-slate-200/80 bg-white/95 p-3.5 pr-9 font-sans shadow-[0_12px_40px_-12px_rgb(15_23_42/0.28),0_2px_6px_-2px_rgb(15_23_42/0.08)] ring-1 ring-black/[0.02] backdrop-blur-md sm:w-[372px]",
          icon: "!m-0 !size-auto",
          content: "min-w-0 flex-1 pt-1",
          title: "text-sm font-semibold leading-5 text-slate-900",
          description: "mt-0.5 text-[13px] leading-5 text-slate-500",
          closeButton:
            "!absolute !left-auto !right-2.5 !top-2.5 !translate-x-0 !translate-y-0 grid !size-6 place-items-center rounded-md !border-0 !bg-transparent text-slate-400 opacity-0 transition hover:!bg-slate-100 hover:text-slate-700 focus-visible:opacity-100 group-hover:opacity-100",
          actionButton:
            "ml-1 mt-0.5 inline-flex h-8 flex-none items-center rounded-lg bg-[#7367f0] px-3 text-xs font-semibold text-white hover:bg-[#6559df]",
          cancelButton:
            "ml-1 mt-0.5 inline-flex h-8 flex-none items-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50",
        },
      }}
    />
  );
}
