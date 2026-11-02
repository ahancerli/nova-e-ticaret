"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Building2, ExternalLink, Globe2, Palette, PanelBottom, Phone, Plus, Save, Search, Share2, X, type LucideIcon } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { Counter, Field, inputCls } from "@/components/admin/form";
import { ImageUpload, type UploadedImage } from "@/features/media/ImageUpload";
import { MAX_LIST_ITEMS, SETTING_GROUPS, SETTING_GROUP_KEYS, settingsOfGroup, type SettingDef, type SettingGroup } from "@/modules/settings/domain/registry";
import type { LinkValue, SettingValue } from "@/modules/settings/domain/values";
import type { AdminSettings } from "@/modules/settings";
import { settingsApi } from "./api";

type FieldValue = string | boolean | string[] | { text: string; href: string } | UploadedImage | null;
type GroupForm = Record<string, FieldValue>;

const GROUP_ICON: Record<SettingGroup, LucideIcon> = {
  general: Globe2, company: Building2, contact: Phone, branding: Palette, seo: Search, social: Share2, footer: PanelBottom,
};
const IMAGE_ASPECT: Record<string, string> = {
  "branding.logo_media_id": "aspect-[3/1]", "branding.favicon_media_id": "aspect-square", "seo.og_image_media_id": "aspect-[1200/630]",
};

function toField(def: SettingDef, v: SettingValue | undefined, images: Record<string, string>): FieldValue {
  switch (def.type) {
    case "boolean": return def.key === "seo.allow_indexing" ? v !== false : v === true;
    case "image": return typeof v === "string" && images[v] ? { id: v, url: images[v] } : null;
    case "link": return v && typeof v === "object" && !Array.isArray(v) ? { text: (v as LinkValue).text, href: (v as LinkValue).href ?? "" } : { text: "", href: "" };
    case "list": return Array.isArray(v) ? v : [];
    default: return typeof v === "string" ? v : "";
  }
}

function toPayload(def: SettingDef, v: FieldValue): unknown {
  switch (def.type) {
    case "image": return v && typeof v === "object" && "id" in v ? v.id : null;
    case "link": {
      const l = v as { text: string; href: string };
      return l.text.trim() ? { text: l.text, href: l.href.trim() || null } : null;
    }
    case "list": return (v as string[]).filter((x) => x.trim());
    default: return v;
  }
}

const groupForm = (group: SettingGroup, data: AdminSettings): GroupForm =>
  Object.fromEntries(settingsOfGroup(group).map((d) => [d.key, toField(d, data.values[d.key], data.images)]));

/**
 * Site ayarları: one form per group, generated from the settings registry (types, limits, help texts). Edits are
 * kept per group while switching; each group is updated on its own with a version check.
 */
export function SettingsManager({ initial, initialGroup }: { initial: AdminSettings; initialGroup: SettingGroup }) {
  const [group, setGroup] = useState<SettingGroup>(initialGroup);
  const [baseline, setBaseline] = useState(() => Object.fromEntries(SETTING_GROUP_KEYS.map((g) => [g, groupForm(g, initial)])) as Record<SettingGroup, GroupForm>);
  const [forms, setForms] = useState(baseline);
  const [versions, setVersions] = useState(initial.groupVersions);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const errors = useFieldErrors();

  const dirtyGroups = useMemo(
    () => new Set(SETTING_GROUP_KEYS.filter((g) => JSON.stringify(forms[g]) !== JSON.stringify(baseline[g]))),
    [forms, baseline],
  );
  const dirty = dirtyGroups.has(group);
  const busy = saving || Object.values(uploading).some(Boolean);

  useEffect(() => {
    if (!dirtyGroups.size || saving) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyGroups, saving]);

  const select = (g: SettingGroup) => {
    setGroup(g);
    errors.clear();
    window.history.replaceState(null, "", `?grup=${g}`);
  };
  const set = (key: string, v: FieldValue) => {
    setForms((f) => ({ ...f, [group]: { ...f[group], [key]: v } }));
    errors.clear(key);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !dirty) return;
    const defs = settingsOfGroup(group);
    const values = Object.fromEntries(defs
      .filter((d) => JSON.stringify(forms[group][d.key]) !== JSON.stringify(baseline[group][d.key]))
      .map((d) => [d.key, toPayload(d, forms[group][d.key] ?? null)]));
    setSaving(true);
    errors.clear();
    try {
      const r = await settingsApi.update(group, values, versions[group]!);
      setVersions((v) => ({ ...v, [group]: r.data.version }));
      setBaseline((b) => ({ ...b, [group]: forms[group] }));
      notify.success(`${SETTING_GROUPS[group].label} güncellendi`, { description: "Mağazada hemen geçerli." });
    } catch (err) {
      const n = errors.fromError(err);
      notify.error(err, { description: n ? "İşaretli alanları kontrol edin." : undefined });
    } finally {
      setSaving(false);
    }
  };

  const meta = SETTING_GROUPS[group];
  const Icon = GROUP_ICON[group];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Site ayarları"
        subtitle="Mağazanın kimliği, iletişim bilgileri, logo, SEO ve footer. Firma bilgileri yasal metinlerdeki değişkenleri de doldurur."
        actions={
          <a href="/" target="_blank" rel="noopener" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <ExternalLink className="size-4" />Mağazayı aç
          </a>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Ayar grupları" className="lg:sticky lg:top-20 lg:self-start">
          <ul className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {SETTING_GROUP_KEYS.map((g) => {
              const GIcon = GROUP_ICON[g];
              const on = g === group;
              return (
                <li key={g} className="flex-none">
                  <button type="button" onClick={() => select(g)} aria-current={on ? "page" : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${on ? "bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white/70"}`}>
                    <GIcon className={`size-4 flex-none ${on ? "text-[#7367f0]" : "text-slate-400"}`} aria-hidden />
                    <span className="whitespace-nowrap">{SETTING_GROUPS[g].label}</span>
                    {dirtyGroups.has(g) ? <span className="ml-auto size-2 flex-none rounded-full bg-amber-500" title="Kaydedilmemiş değişiklik" aria-label="Kaydedilmemiş değişiklik" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <form onSubmit={submit} noValidate className="min-w-0 space-y-4">
          <AdminCard>
            <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
              <span className="inline-flex size-9 flex-none items-center justify-center rounded-xl bg-[#7367f0]/10 text-[#7367f0]"><Icon className="size-5" /></span>
              <div>
                <h2 className="text-base font-semibold text-slate-900">{meta.label}</h2>
                <p className="text-sm text-slate-500">{meta.description}</p>
              </div>
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              {settingsOfGroup(group).map((def) => (
                <SettingField key={def.key} def={def} value={forms[group][def.key] ?? null} error={errors.get(def.key)}
                  onChange={(v) => set(def.key, v)} onUploading={(u) => setUploading((s) => ({ ...s, [def.key]: u }))} />
              ))}
            </div>
          </AdminCard>

          <div className="sticky bottom-4 z-30">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
              <p className="flex items-center gap-2 text-sm text-slate-500">
                {dirty ? "Bu grupta kaydedilmemiş değişiklikler var." : <><BadgeCheck className="size-4 text-emerald-600" aria-hidden />Güncel</>}
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={!dirty || busy} onClick={() => setForms((f) => ({ ...f, [group]: baseline[group] }))}
                  className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  Değişiklikleri geri al
                </button>
                <button type="submit" disabled={!dirty || busy}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60">
                  <Save className="size-4" />{saving ? "Bekleyin…" : "Güncelle"}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingField({ def, value, error, onChange, onUploading }: {
  def: SettingDef;
  value: FieldValue;
  error?: string;
  onChange: (v: FieldValue) => void;
  onUploading: (u: boolean) => void;
}) {
  const id = `set-${def.key.replace(/\./g, "-")}`;
  const hint = def.help ?? (def.templateVar ? <>Yasal metinlerde <code className="font-mono">{`{{${def.templateVar}}}`}</code></> : undefined);
  const wide = def.type === "textarea" || def.type === "image" || def.type === "link" || def.type === "list" || def.type === "boolean";

  if (def.type === "image") {
    return (
      <div className="sm:col-span-2 sm:max-w-md">
        <ImageUpload label={def.label} hint={def.help} folder="branding" aspect={IMAGE_ASPECT[def.key] ?? "aspect-video"}
          value={value as UploadedImage | null} onChange={onChange} onUploadingChange={onUploading} error={error} />
      </div>
    );
  }

  if (def.type === "boolean") {
    return (
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 sm:col-span-2">
        <span>
          <span className="block text-sm font-medium text-slate-800">{def.label}</span>
          {def.help ? <span className="block text-xs text-slate-500">{def.help}</span> : null}
        </span>
        <input type="checkbox" className="size-5 flex-none accent-[#7367f0]" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
      </label>
    );
  }

  if (def.type === "link") {
    const l = value as { text: string; href: string };
    return (
      <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <legend className="sr-only">{def.label}</legend>
        <Field id={`${id}-text`} label={def.label} error={error} hint={def.help}>
          <input id={`${id}-text`} className={inputCls} value={l.text} maxLength={def.max} aria-invalid={!!error} onChange={(e) => onChange({ ...l, text: e.target.value })} />
        </Field>
        <Field id={`${id}-href`} label="Bağlantı" hint="/kampanyalar veya https://…">
          <input id={`${id}-href`} className={inputCls} value={l.href} maxLength={300} placeholder="/kampanyalar" onChange={(e) => onChange({ ...l, href: e.target.value })} />
        </Field>
      </fieldset>
    );
  }

  if (def.type === "list") {
    const items = value as string[];
    return (
      <Field id={`${id}-0`} label={def.label} error={error} hint={def.help} className="sm:col-span-2">
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <input id={`${id}-${i}`} className={inputCls} value={item} maxLength={def.max} aria-label={`${def.label} ${i + 1}`}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
              <button type="button" aria-label={`${i + 1}. öğeyi kaldır`} onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="inline-flex size-10 flex-none items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-red-600">
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        {items.length < MAX_LIST_ITEMS ? (
          <button type="button" onClick={() => onChange([...items, ""])} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#7367f0] hover:underline">
            <Plus className="size-4" />Öğe ekle
          </button>
        ) : null}
      </Field>
    );
  }

  if (def.type === "color") {
    const v = (value as string) || "#f26a1b";
    return (
      <Field id={id} label={def.label} error={error} hint={def.help}>
        <div className="flex gap-2">
          <input type="color" aria-label={`${def.label} seçici`} value={/^#[0-9a-f]{6}$/i.test(v) ? v : "#000000"} onChange={(e) => onChange(e.target.value)}
            className="h-10 w-14 flex-none cursor-pointer rounded-lg border border-slate-200 bg-white p-1" />
          <input id={id} className={`${inputCls} font-mono`} value={value as string} maxLength={7} placeholder="#f26a1b" aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} />
        </div>
      </Field>
    );
  }

  const text = value as string;
  const counter = def.max && (def.type === "text" || def.type === "textarea") ? <Counter value={text} max={def.max} /> : null;
  return (
    <Field id={id} label={def.label} required={def.required} error={error} className={wide ? "sm:col-span-2" : ""}
      hint={hint || counter ? <span className="flex justify-between gap-3"><span>{hint}</span>{counter}</span> : undefined}>
      {def.type === "textarea" ? (
        <textarea id={id} className={`${inputCls} min-h-24 py-2`} value={text} maxLength={def.max} placeholder={def.placeholder} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className={inputCls} value={text} maxLength={def.max ?? (def.lengths ? Math.max(...def.lengths) : undefined)} placeholder={def.placeholder} aria-invalid={!!error}
          type={def.type === "email" ? "email" : def.type === "phone" ? "tel" : def.type === "url" ? "url" : "text"}
          inputMode={def.type === "digits" ? "numeric" : def.type === "phone" ? "tel" : def.type === "url" ? "url" : def.type === "email" ? "email" : undefined}
          onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}
