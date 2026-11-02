"use client";

import { createPortal } from "react-dom";
import { useIsClient } from "@/lib/motion";

/** Renders children into <body>. Every overlay (drawer, dialog, progress bar) goes through this. */
export function Portal({ children }: { children: React.ReactNode }) {
  return useIsClient() ? createPortal(children, document.body) : null;
}
