"use client";

import { useEffect, useState } from "react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { Field, inputCls } from "@/components/admin/form";
import type { SupportSettings } from "@/modules/support/domain/support";
import { supportAdminApi } from "./api";

/** Canlı destek ayarları: module switch (shop button + new messages) and the widget texts. */
export function SupportSettingsDrawer({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (s: SupportSettings) => void }) {
  const [s, setS] = useState<SupportSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const errors = useFieldErrors();

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setS(null);
  }

  useEffect(() => {
    if (!open) return;
    supportAdminApi.settings().then((r) => setS(r.data)).catch((err) => { notify.error(err); onClose(); });
  }, [open, onClose]);

  const save = async () => {
    if (!s) return;
    setBusy(true);
    errors.clear();
    try {
      const { updatedAt, ...rest } = s;
      const r = await supportAdminApi.saveSettings({ ...rest, expectedUpdatedAt: updatedAt });
      notify.success("Canlı destek ayarları güncellendi");
      onSaved(r.data);
      onClose();
    } catch (err) {
      if (!errors.fromError(err)) notify.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminDrawer open={open} onClose={onClose} title="Canlı destek ayarları" subtitle="Mağazadaki Bize ulaşın penceresi"
      footer={<div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-xl px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">Vazgeç</button>
        <button type="button" disabled={!s || busy} onClick={() => void save()} className="h-10 rounded-xl bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#6559df] disabled:opacity-50">Güncelle</button>
      </div>}>
      {!s ? <div className="h-64 animate-pulse rounded-2xl bg-slate-100" /> : (
        <div className="space-y-5">
          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 p-4">
            <span>
              <span className="block text-sm font-medium text-slate-800">Canlı destek açık</span>
              <span className="block text-xs text-slate-500">Açıkken mağazanın sağ altında Bize ulaşın butonu görünür ve üyeler yazabilir. Kapatınca mevcut konuşmaları yanıtlamaya devam edebilirsiniz.</span>
            </span>
            <input type="checkbox" role="switch" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} className="mt-1 size-5 flex-none accent-[#7367f0]" />
          </label>
          <Field id="support-team" label="Pencere başlığı" required error={errors.get("teamName")} hint="Örnek: Müşteri hizmetleri">
            <input id="support-team" className={inputCls} maxLength={60} value={s.teamName} onChange={(e) => setS({ ...s, teamName: e.target.value })} aria-invalid={Boolean(errors.get("teamName"))} />
          </Field>
          <Field id="support-welcome" label="Karşılama mesajı" required error={errors.get("welcomeMessage")} hint="Temsilci çevrimiçiyken pencerenin ilk balonu.">
            <textarea id="support-welcome" rows={3} className={inputCls} maxLength={300} value={s.welcomeMessage} onChange={(e) => setS({ ...s, welcomeMessage: e.target.value })} aria-invalid={Boolean(errors.get("welcomeMessage"))} />
          </Field>
          <Field id="support-offline" label="Çevrimdışı mesajı" required error={errors.get("offlineMessage")} hint="Panelde açık temsilci yokken gösterilir; üyeler yine yazabilir, yanıtınızı sonra görürler.">
            <textarea id="support-offline" rows={3} className={inputCls} maxLength={300} value={s.offlineMessage} onChange={(e) => setS({ ...s, offlineMessage: e.target.value })} aria-invalid={Boolean(errors.get("offlineMessage"))} />
          </Field>
        </div>
      )}
    </AdminDrawer>
  );
}
