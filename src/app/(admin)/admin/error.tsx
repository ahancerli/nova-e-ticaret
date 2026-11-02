"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/RouteError";

/** Admin pages: rendered inside the admin shell, so navigation keeps working. */
export default function AdminError(props: RouteErrorProps) {
  return <RouteError {...props} tone="admin" home={{ href: "/admin", label: "Panele dön" }} />;
}
