"use client";

import { RouteError, type RouteErrorProps } from "@/components/ui/RouteError";

export default function AdminLoginError(props: RouteErrorProps) {
  return <RouteError {...props} tone="admin" home={{ href: "/", label: "Mağazaya dön" }} />;
}
