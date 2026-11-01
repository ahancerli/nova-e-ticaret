"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { BellIcon, LogoutIcon, SettingsIcon } from "@/components/icons";

export function AdminHeaderActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api("/api/admin/auth/logout", { method: "POST" });
      router.replace("/admin/giris");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button type="button" className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700" aria-label="Bildirimler">
        <BellIcon className="h-4 w-4" />
      </button>
      <button type="button" className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700" aria-label="Ayarlar">
        <SettingsIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <LogoutIcon className="size-4" />
        Çıkış
      </button>
    </div>
  );
}
