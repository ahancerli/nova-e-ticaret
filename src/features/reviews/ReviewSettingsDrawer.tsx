"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminDrawer } from "@/components/admin/AdminDrawer";
import { Field, inputCls } from "@/components/admin/form";
import { MODERATION_MODES, type ModerationMode, type ReviewSettings } from "@/modules/reviews/domain/review";
import { reviewsApi } from "./api";

/** Yorum ayarları: moderation mode, who may review, anonymity, minimum length, words that always need approval. */
export function ReviewSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, setS] = useState<ReviewSettings | null>(null);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const errors = useFieldErrors();

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setS(null);
  }

  useEffect(() => {
    if (!open) return;
    reviewsApi.settings().then((r) => { setS(r.data); setWords(r.data.blockedWords.join(", ")); }).catch((err) => { notify.error(err); onClose(); });
  }, [open, onClose]);

  const save = async () => {
    if (!s) return;
    setBusy(true);
    errors.clear();
    try {
      const { updatedAt, ...rest } = s;
      const r = await reviewsApi.saveSettings({ ...rest, blockedWords: words.split(/[,\n]/).map((w) => w.trim()).filter(Boolean), expectedUpdatedAt: updatedAt });
      setS(r.data);
      notify.success("Yorum ayarları güncellendi");
      onClose();
    } catch (err) {
      if (!errors.fromError(err)) notify.error(err);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: "requirePurchase" | "allowAnonymous", label: string, hint: string) => s ? (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-slate-200 p-4">
      <span><span className="block text-sm font-medium text-slate-800">{label}</span><span className="block text-xs text-slate-500">{hint}</span></span>
      <input type="checkbox" role="switch" checked={s[key]} onChange={(e) => setS({ ...s, [key]: e.target.checked })} className="mt-1 size-5 flex-none accent-[#7367f0]" />
    </label>
  ) : null;

  return (
    <AdminDrawer open={open} onClose={onClose} title="Yorum ayarları" subtitle="Mağazadaki tüm ürün yorumları için geçerlidir"
      footer={<div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-xl px-4 text-sm font-medium text-slate-600 hover:bg-slate-100">Vazgeç</button>
        <button type="button" disabled={!s || busy} onClick={() => void save()} className="h-10 rounded-xl bg-[#7367f0] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#6559df] disabled:opacity-50">Güncelle</button>
      </div>}>
      {!s ? <div className="h-64 animate-pulse rounded-2xl bg-slate-100" /> : (
        <div className="space-y-6">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold text-slate-800">Yayınlama</legend>
            {(Object.entries(MODERATION_MODES) as [ModerationMode, { label: string; description: string }][]).map(([key, m]) => (
              <label key={key} className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${s.moderationMode === key ? "border-[#7367f0] bg-[#7367f0]/5" : "border-slate-200 hover:bg-slate-50"}`}>
                <input type="radio" name="moderation-mode" checked={s.moderationMode === key} onChange={() => setS({ ...s, moderationMode: key })} className="mt-1 accent-[#7367f0]" />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">{key === "manual" ? <ShieldCheck className="size-4 text-emerald-600" /> : null}{m.label}</span>
                  <span className="block text-xs text-slate-500">{m.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="space-y-2">
            {toggle("requirePurchase", "Yalnız satın alanlar yorum yapabilsin", "Ödemesi alınmış bir siparişte bu ürün olmalı (önerilen). Kapalıyken her üye yorum yazabilir.")}
            {toggle("allowAnonymous", "İsmi gizli yorum", "Müşteri, adının “Gizli müşteri” olarak görünmesini seçebilir.")}
          </div>
          <Field id="min-length" label="En kısa yorum (karakter)" error={errors.get("minBodyLength")}>
            <input id="min-length" type="number" min={1} max={500} value={s.minBodyLength} onChange={(e) => setS({ ...s, minBodyLength: Number(e.target.value) })} className={`${inputCls} max-w-32`} />
          </Field>
          <Field id="blocked-words" label="Her zaman onaya düşen kelimeler" error={errors.get("blockedWords")}
            hint="Virgülle ayırın. Bu kelimeleri içeren yorumlar otomatik yayın modunda da onay bekler.">
            <textarea id="blocked-words" rows={3} value={words} onChange={(e) => setWords(e.target.value)} className={inputCls} placeholder="sahte, dolandırıcı, …" />
          </Field>
        </div>
      )}
    </AdminDrawer>
  );
}
