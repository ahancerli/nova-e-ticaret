"use client";

import { Link2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { AdminFormDialog } from "./AdminFormDialog";

const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Istanbul" });

/**
 * Shows an invitation / reset link once. The server keeps only its hash, so it cannot be shown again — a new
 * link has to be created. Until an e-mail provider is connected, the admin passes it on (e-posta, WhatsApp…).
 */
export function OneTimeLinkDialog({ link, title, recipient, onClose }: {
  link: { path: string; expiresAt: string } | null;
  title: string;
  recipient: string;
  onClose: () => void;
}) {
  // Only rendered with a link after a user action (client side), so window is available.
  const url = link && typeof window !== "undefined" ? `${window.location.origin}${link.path}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      notify.success("Bağlantı kopyalandı");
    } catch {
      notify.error("Kopyalanamadı; bağlantıyı seçip elle kopyalayın.");
    }
  };

  return (
    <AdminFormDialog
      open={!!link}
      title={title}
      icon={Link2}
      tone="success"
      description={<>Bu bağlantıyı <b className="font-medium text-slate-700">{recipient}</b> kişisine iletin. Parolayı kişi kendisi belirler; bağlantı tek kullanımlıktır ve yalnız şimdi gösterilir.</>}
      submitLabel="Bağlantıyı kopyala"
      cancelLabel="Kapat"
      onSubmit={copy}
      onCancel={onClose}
    >
      <label htmlFor="one-time-link" className="sr-only">Bağlantı</label>
      <input id="one-time-link" readOnly value={url} onFocus={(e) => e.currentTarget.select()}
        className="input h-11 w-full border-slate-200 bg-slate-50 font-mono text-xs text-slate-700" />
      {link ? <p className="text-xs text-slate-500">Geçerlilik: {dt.format(new Date(link.expiresAt))} tarihine kadar.</p> : null}
    </AdminFormDialog>
  );
}
