"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authApi } from "@/features/auth/api";
import { useCart } from "@/features/cart/CartProvider";

/** Ends the storefront session; the cart shown in the header is the guest cart again. */
export function LogoutButton({ className = "btn btn-ghost" }: { className?: string }) {
  const router = useRouter();
  const { refresh } = useCart();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={className} disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        await authApi.logout("storefront");
      } finally {
        await refresh().catch(() => undefined);
        router.push("/");
        router.refresh();
      }
    }}>{busy ? "Çıkış yapılıyor…" : "Çıkış yap"}</button>
  );
}
