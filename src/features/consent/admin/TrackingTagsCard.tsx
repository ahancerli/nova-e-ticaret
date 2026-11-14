"use client";

import { useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Field, inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import type { ConsentAdminView, TrackingTagView } from "@/modules/consent";
import { CATEGORY_INFO } from "@/modules/consent/domain/consent";
import { TAG_PROVIDERS, type TagProviderDef } from "@/modules/consent/domain/tags";
import { consentApi } from "../api";

const primary = "inline-flex h-9 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60";
const btn = "inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";
const pct = (n: number, total: number) => (total ? `%${Math.round((n / total) * 100)}` : "—");

function TagRow({ def, tag, onSaved }: { def: TagProviderDef; tag: TrackingTagView | null; onSaved: (v: ConsentAdminView) => void }) {
  const errors = useFieldErrors();
  const [config, setConfig] = useState<Record<string, string>>(() => Object.fromEntries(def.fields.map((f) => [f.key, tag?.config[f.key] ?? ""])));
  const [isActive, setIsActive] = useState(tag?.isActive ?? true);
  // write-only: typed value replaces the stored key, null removes it, untouched keys are not sent
  const [secrets, setSecrets] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const ready = def.status === "ready";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    errors.clear();
    try {
      const typed = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v === null || v.trim()));
      const r = await consentApi.admin.saveTag(def.code, { isActive, config, ...(Object.keys(typed).length ? { secrets: typed } : {}), expectedUpdatedAt: tag?.updatedAt ?? null });
      onSaved(r.data);
      const renewed = isActive && !tag?.isActive;
      notify.success(tag ? `${def.name} güncellendi` : `${def.name} eklendi`, renewed ? { description: "Yeni bir firma etkinleştiği için ziyaretçilere onay yeniden sorulacak." } : undefined);
    } catch (err) {
      errors.fromError(err);
      notify.error(err, { fallback: "Etiket kaydedilemedi." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!tag) return;
    setBusy(true);
    try {
      onSaved((await consentApi.admin.removeTag(def.code, tag.updatedAt)).data);
      notify.success(`${def.name} kaldırıldı`);
    } catch (err) {
      notify.error(err, { fallback: "Etiket kaldırılamadı." });
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  const serverSide = (def.secrets ?? []).some((f) => tag?.secrets[f.key]);
  const status = !ready ? <AdminBadge>Yakında</AdminBadge> : !tag ? <AdminBadge>Bağlı değil</AdminBadge> : tag.isActive ? <AdminBadge tone="green">Çalışıyor</AdminBadge> : <AdminBadge tone="amber">Duraklatıldı</AdminBadge>;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
            {def.name}
            <AdminBadge tone={def.category === "marketing" ? "purple" : "blue"}>{CATEGORY_INFO[def.category].label}</AdminBadge>
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{def.description}</p>
        </div>
        <div className="flex items-center gap-2">
          {serverSide && tag?.isActive && <AdminBadge tone="green">Sunucudan da gönderiliyor</AdminBadge>}
          {status}
          <a href={def.website} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-slate-700" aria-label={`${def.name} sitesi`}><ExternalLink className="h-4 w-4" /></a>
        </div>
      </div>
      {ready ? (
        <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-3">
          {def.fields.map((f) => {
            const id = `${def.code}.${f.key}`;
            return (
              <Field key={f.key} id={id} label={f.label} required={f.required} error={errors.get(`config.${f.key}`)} hint={f.hint} className="min-w-56 flex-1">
                <input id={id} className={inputCls} placeholder={f.placeholder} value={config[f.key] ?? ""} spellCheck={false} autoComplete="off"
                  aria-invalid={errors.has(`config.${f.key}`)} onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))} />
              </Field>
            );
          })}
          {def.secrets?.map((f) => {
            const id = `${def.code}.secret.${f.key}`;
            const hint = tag?.secrets[f.key];
            const removing = secrets[f.key] === null;
            return (
              <Field key={f.key} id={id} label={f.label} error={errors.get(`secrets.${f.key}`)} hint={f.hint} className="min-w-56 flex-1">
                <div className="flex items-center gap-2">
                  <input id={id} type="password" className={inputCls} autoComplete="new-password" spellCheck={false} disabled={removing}
                    placeholder={removing ? "Kaydedince silinecek" : hint ? `Kayıtlı (…${hint}), değiştirmek için yazın` : "Gizli anahtar"}
                    value={secrets[f.key] ?? ""} aria-invalid={errors.has(`secrets.${f.key}`)} onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))} />
                  {hint && (
                    <button type="button" className={btn} onClick={() => setSecrets((s) => ({ ...s, [f.key]: removing ? "" : null }))}>{removing ? "Vazgeç" : "Sil"}</button>
                  )}
                </div>
              </Field>
            );
          })}
          <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-[#7367f0]" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />Etkin
          </label>
          <div className="flex h-10 items-center gap-2">
            <button type="submit" className={primary} disabled={busy}>{tag ? "Güncelle" : "Ekle"}</button>
            {tag && <button type="button" className={btn} disabled={busy} onClick={() => setConfirmRemove(true)} aria-label={`${def.name} etiketini kaldır`}><Trash2 className="h-4 w-4" /></button>}
          </div>
        </form>
      ) : (
        <p className="mt-2 text-xs text-slate-500">Bu firma için entegrasyon henüz yapılmadı. Bu firmayla çalışmak için yazılım firmanıza (geliştirici ekibe) bilgi verin.</p>
      )}
      <AdminConfirmDialog
        open={confirmRemove} busy={busy} confirmLabel="Kaldır" busyLabel="Kaldırılıyor…"
        title={`${def.name} kaldırılsın mı?`} description="Etiket vitrine artık yüklenmez. Girdiğiniz kimlik silinir."
        onConfirm={remove} onCancel={() => setConfirmRemove(false)}
      />
    </li>
  );
}

/** Vendor tags from the code catalog; each loads in the storefront only after consent for its category. */
export function TrackingTagsCard({ view, onSaved }: { view: ConsentAdminView; onSaved: (v: ConsentAdminView) => void }) {
  const s = view.stats30d;
  const byCode = new Map(view.tags.map((t) => [t.code, t]));
  const stats = [
    { label: "Tercih (30 gün)", value: s.total.toLocaleString("tr-TR") },
    { label: "Tümünü kabul", value: pct(s.acceptAll, s.total) },
    { label: "Tümünü ret", value: pct(s.rejectAll, s.total) },
    { label: "Analitik izni", value: pct(s.analytics, s.total) },
    { label: "Pazarlama izni", value: pct(s.marketing, s.total) },
  ];
  return (
    <div className="max-w-5xl space-y-6">
      {!view.settings.bannerEnabled && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Çerez onayı kapalı: etiketler kayıtlı olsa da vitrine yüklenmez. “Onay banner&apos;ı” sekmesinden açın.</p>
      )}
      <AdminCard>
        <dl className="grid grid-cols-2 divide-slate-100 sm:grid-cols-5 sm:divide-x">
          {stats.map((x) => (
            <div key={x.label} className="px-5 py-4">
              <dt className="text-xs text-slate-500">{x.label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{x.value}</dd>
            </div>
          ))}
        </dl>
      </AdminCard>
      <AdminCard>
        <AdminCardTitle
          title="Etiketler"
          subtitle="Satış olayları (ürün listesi ve ürün görüntüleme, sepete ekleme, sepet, ödeme, satın alma) her etikete kendi formatında otomatik gider. GA4 ve Meta için gizli anahtar da girerseniz satın alma, ödeme onaylanınca sunucudan da gönderilir; reklam engelleyici kullanan ziyaretçilerin satışları da sayılır."
        />
        <ul className="divide-y divide-slate-100">
          {TAG_PROVIDERS.map((def) => (
            <TagRow key={`${def.code}-${byCode.get(def.code)?.updatedAt ?? "new"}`} def={def} tag={byCode.get(def.code) ?? null} onSaved={onSaved} />
          ))}
        </ul>
      </AdminCard>
    </div>
  );
}
