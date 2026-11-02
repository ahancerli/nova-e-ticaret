"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/RouteError";

/** Fallback for anything outside a more specific segment boundary. */
export default function Error(props: RouteErrorProps) {
  return <RouteError {...props} tone="storefront" home={{ href: "/", label: "Ana sayfaya dön" }} />;
}
