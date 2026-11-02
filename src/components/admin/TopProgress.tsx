"use client";

import { Portal } from "@/components/ui/Portal";

/**
 * Slim indeterminate bar pinned to the top of the viewport while a route segment streams.
 * Portalled to <body> so ancestor transforms (page-in animation) cannot offset it.
 */
export function TopProgress() {
  return (
    <Portal>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-indigo-100/60" aria-hidden>
        <div className="h-full w-full origin-left animate-progress bg-gradient-to-r from-transparent via-[#7367f0] to-[#a29bfe]" />
      </div>
    </Portal>
  );
}
