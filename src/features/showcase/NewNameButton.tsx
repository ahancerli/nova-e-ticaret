"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { notify } from "@/lib/toast";
import { AdminFormDialog } from "@/components/admin/AdminFormDialog";
import { inputCls } from "@/components/admin/form";

/** "New slider / collection" button: asks for a name in a small dialog. */
export function NewNameButton({ label, placeholder, onCreate }: { label: string; placeholder: string; onCreate: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await onCreate(name.trim());
      notify.success(`${label.replace(/^Yeni /, "")} oluşturuldu`, { description: name.trim() });
      setOpen(false);
      setName("");
    } catch (err) {
      notify.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Plus className="size-4" />{label}</button>
      <AdminFormDialog open={open} title={label} submitLabel="Oluştur" busy={busy} submitDisabled={name.trim().length < 2} onSubmit={submit} onCancel={() => setOpen(false)}>
        <label htmlFor="new-name" className="mb-1 block text-xs font-medium text-slate-600">Ad</label>
        <input id="new-name" autoFocus className={inputCls} value={name} maxLength={80} placeholder={placeholder} onChange={(e) => setName(e.target.value)} />
      </AdminFormDialog>
    </>
  );
}
