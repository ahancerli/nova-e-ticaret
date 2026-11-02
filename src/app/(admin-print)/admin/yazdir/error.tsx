"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/RouteError";

export default function PrintError(props: RouteErrorProps) {
  return <RouteError {...props} tone="admin" home={{ href: "/admin/siparisler", label: "Siparişlere dön" }} />;
}
