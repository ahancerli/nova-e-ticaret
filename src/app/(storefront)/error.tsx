"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/RouteError";

/** Storefront pages: the header / footer of the storefront layout stay usable. */
export default function StorefrontError(props: RouteErrorProps) {
  return <RouteError {...props} tone="storefront" home={{ href: "/", label: "Ana sayfaya dön" }} />;
}
