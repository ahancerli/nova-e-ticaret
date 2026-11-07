"use client";

import { useState } from "react";
import { Ban } from "lucide-react";
import { AdminFormDialog } from "@/components/admin/AdminFormDialog";
import { inputCls, labelCls } from "@/components/admin/form";
import { REJECT_REASONS, type RejectReason } from "@/modules/reviews/domain/review";

/** "Yayınlama": the reason is required (stored, shown to the customer under Hesabım); the note stays internal. */
export function RejectDialog({ open, count, busy, onSubmit, onCancel }: {
  open: boolean; count: number; busy: boolean; onSubmit: (reason: RejectReason, note: string | null) => void; onCancel: () => void;
}) {
  const [reason, setReason] = useState<RejectReason | "">("");
  const [note, setNote] = useState("");
  return (
    <AdminFormDialog open={open} title={count > 1 ? `${count} yorumu yayınlama` : "Yorumu yayınlama"} icon={Ban} tone="danger" busy={busy}
      description="Yorum mağazada görünmez. Müşteri, nedeni Hesabım › Değerlendirmelerim sayfasında görür."
      submitLabel="Reddet" submitDisabled={!reason} onCancel={onCancel}
      onSubmit={() => reason && onSubmit(reason, note.trim() || null)}>
      <div className="space-y-4">
        <fieldset>
          <legend className={labelCls}>Neden<span className="text-red-500" aria-hidden> *</span></legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {(Object.entries(REJECT_REASONS) as [RejectReason, string][]).map(([key, label]) => (
              <label key={key} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${reason === key ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
                <input type="radio" name="reject-reason" value={key} checked={reason === key} onChange={() => setReason(key)} className="accent-red-600" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="reject-note" className={labelCls}>İç not (isteğe bağlı)</label>
          <textarea id="reject-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="Yalnız panel kullanıcıları görür" />
        </div>
      </div>
    </AdminFormDialog>
  );
}
