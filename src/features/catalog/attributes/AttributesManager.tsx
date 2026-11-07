"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Barcode, Check, Images, Info, Layers, Plus, Save, Search, Sparkles, Trash2, X } from "lucide-react";
import { notify } from "@/lib/toast";
import { useFieldErrors } from "@/lib/use-field-errors";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { Field, inputCls, labelCls } from "@/components/admin/form";
import {
  ATTRIBUTE_ROLES, ATTRIBUTE_TEMPLATES, ATTRIBUTE_TEMPLATE_KEYS, ATTRIBUTE_TYPES, DISPLAY_STYLES,
  type AttributeInput, type AttributeRole, type AttributeRow, type AttributeTemplateKey, type AttributeType, type DisplayStyle,
} from "@/modules/catalog/domain/attribute";
import { attributesApi } from "./api";

type Category = { id: string; label: string; hint?: string };
type Tab = "general" | "values" | "categories";

const blank = (role: AttributeRole): AttributeInput => role === "variant"
  ? { label: "", dataType: "select", unit: null, description: null, isVariantAxis: true, isFilterable: true, displayStyle: "button", variesMedia: false }
  : { label: "", dataType: "select", unit: null, description: null, isVariantAxis: false, isFilterable: true, displayStyle: "button", variesMedia: false };
const SPEC_TYPES: AttributeType[] = ["select", "multiselect", "text", "number", "boolean"];
const fold = (s: string) => s.toLocaleLowerCase("tr-TR");
/** "36, 37; 38" or one per line → ["36", "37", "38"]. */
const splitValues = (s: string) => s.split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean);

/**
 * Katalog › Özellikler & varyantlar. Every attribute is one of two things, and the screen asks that first:
 * - Varyant (seçenek): the shopper picks it; each value gets its own price, stock, barcode and — for Renk — photos;
 * - Ürün bilgisi: describes the product (Materyal, Disk kapasitesi) in the specs table and filters.
 * Values, category rules and the shop barcode prefix live next to it.
 */
export function AttributesManager({ attributes, categories, barcode }: { attributes: AttributeRow[]; categories: Category[]; barcode: { prefix: string; nextValue: number } }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | "new" | null>(attributes[0]?.id ?? "new");
  const [newRole, setNewRole] = useState<AttributeRole>("variant");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = attributes.filter((a) => !q.trim() || fold(`${a.label} ${a.code}`).includes(fold(q.trim())));
  const current = selected && selected !== "new" ? attributes.find((a) => a.id === selected) ?? null : null;

  const applyTemplate = async (key: AttributeTemplateKey) => {
    setBusy(true);
    try {
      const r = await attributesApi.template(key);
      notify.success(`“${ATTRIBUTE_TEMPLATES[key].title}” eklendi`, { description: `${ATTRIBUTE_TEMPLATES[key].options.length} değerle hazır; düzenleyebilirsiniz.` });
      setSelected(r.data.id);
      router.refresh();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };
  const startNew = (role: AttributeRole) => { setNewRole(role); setSelected("new"); };

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Özellikler & varyantlar"
        subtitle="Ürünlerinizin seçeneklerini (Renk, Beden, Numara, Ölçü) ve teknik bilgilerini (Materyal, Kapasite) burada tanımlarsınız. Ürün düzenleyici bu listeyi kullanır." />

      <div className="grid gap-3 md:grid-cols-2">
        {(["variant", "spec"] as const).map((role) => {
          const r = ATTRIBUTE_ROLES[role];
          const count = attributes.filter((a) => a.isVariantAxis === (role === "variant")).length;
          return (
            <div key={role} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <span className={`grid size-10 flex-none place-items-center rounded-xl ${role === "variant" ? "bg-[#7367f0] text-white" : "bg-slate-100 text-slate-600"}`}>{role === "variant" ? <Layers className="size-5" /> : <Info className="size-5" />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">{r.label}<AdminBadge tone={role === "variant" ? "purple" : "slate"}>{count}</AdminBadge></span>
                <span className="mt-0.5 block text-xs text-slate-500">{r.hint}</span>
                <span className="mt-1 block text-xs text-slate-400">Örn. {r.examples}</span>
              </span>
              <button type="button" onClick={() => startNew(role)} className="inline-flex h-8 flex-none items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><Plus className="size-3.5" />Ekle</button>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-6 xl:self-start">
          <AdminCard className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-100 p-3">
              <label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 px-3">
                <Search className="size-4 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Özellik ara" aria-label="Özellik ara" className="h-9 w-full bg-transparent text-sm outline-none" />
              </label>
            </div>
            <div className="max-h-[560px] overflow-y-auto">
              {(["variant", "spec"] as const).map((role) => {
                const list = shown.filter((a) => a.isVariantAxis === (role === "variant"));
                return (
                  <section key={role} aria-label={ATTRIBUTE_ROLES[role].label}>
                    <p className="sticky top-0 z-10 bg-slate-50/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 backdrop-blur">{role === "variant" ? "Varyant özellikleri" : "Ürün bilgileri"}</p>
                    <ul className="divide-y divide-slate-50">
                      {list.map((a) => (
                        <li key={a.id}>
                          <button type="button" onClick={() => setSelected(a.id)} aria-current={selected === a.id}
                            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${selected === a.id ? "bg-[#7367f0]/10" : "hover:bg-slate-50"}`}>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-800">
                                {a.label}{a.unit ? <span className="text-slate-400">({a.unit})</span> : null}
                                {a.variesMedia ? <Images className="size-3.5 text-[#7367f0]" aria-label="görseli değiştirir" /> : null}
                              </span>
                              <span className="block text-xs text-slate-500">
                                {a.isVariantAxis ? DISPLAY_STYLES[a.displayStyle].label : ATTRIBUTE_TYPES[a.dataType].label}
                                {a.options.length ? ` · ${a.options.length} değer` : ""} · {a.productCount ? `${a.productCount} ürün` : "kullanılmıyor"}
                              </span>
                            </span>
                            {a.options.some((o) => o.colorHex) ? (
                              <span className="flex -space-x-1">{a.options.filter((o) => o.colorHex).slice(0, 5).map((o) => <span key={o.id} className="size-3.5 rounded-full border border-white ring-1 ring-slate-200" style={{ background: o.colorHex! }} />)}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                      {!list.length ? <li className="px-4 py-3 text-xs text-slate-400">{q ? "Sonuç yok." : "Henüz yok."}</li> : null}
                    </ul>
                  </section>
                );
              })}
            </div>
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Hazır şablonlar" subtitle="Tek tıkla, yaygın değerleriyle eklenir." />
            <div className="space-y-3 p-4">
              {(["variant", "spec"] as const).map((role) => (
                <div key={role}>
                  <p className={labelCls}>{role === "variant" ? "Varyant" : "Ürün bilgisi"}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ATTRIBUTE_TEMPLATE_KEYS.filter((k) => ATTRIBUTE_TEMPLATES[k].attribute.isVariantAxis === (role === "variant")).map((k) => {
                      const t = ATTRIBUTE_TEMPLATES[k];
                      const exists = attributes.some((a) => a.code === t.attribute.code);
                      return (
                        <button key={k} type="button" disabled={busy || exists} onClick={() => applyTemplate(k)} title={exists ? "Zaten ekli" : t.hint}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 transition hover:border-[#7367f0] hover:bg-[#7367f0]/5 disabled:cursor-default disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-transparent">
                          {exists ? <Check className="size-3.5 text-emerald-600" /> : <Sparkles className="size-3.5 text-[#7367f0]" />}{t.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </AdminCard>

          <BarcodeCard initial={barcode} />
        </div>

        <div className="min-w-0">
          {selected === "new" || !current ? (
            <AttributeForm key={`new-${newRole}`} initial={null} role={newRole} onSaved={(id) => { setSelected(id); router.refresh(); }} />
          ) : (
            <AttributeDetail key={current.id} attribute={current} categories={categories} onDeleted={() => { setSelected(null); router.refresh(); }} />
          )}
        </div>
      </div>
    </div>
  );
}

function AttributeDetail({ attribute, categories, onDeleted }: { attribute: AttributeRow; categories: Category[]; onDeleted: () => void }) {
  const router = useRouter();
  const hasValues = attribute.dataType === "select" || attribute.dataType === "multiselect";
  const [tab, setTab] = useState<Tab>(hasValues && attribute.options.length === 0 ? "values" : "general");
  const tabs: { key: Tab; label: string }[] = [
    { key: "general", label: "Genel" },
    ...(hasValues ? [{ key: "values" as const, label: `Değerler (${attribute.options.length})` }] : []),
    { key: "categories", label: `Kategoriler (${attribute.categories.length})` },
  ];
  return (
    <AdminCard>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 pt-4">
        <div className="min-w-0 flex-1 pb-3">
          <p className="flex items-center gap-2 text-base font-semibold text-slate-900">{attribute.label}
            <AdminBadge tone={attribute.isVariantAxis ? "purple" : "slate"}>{attribute.isVariantAxis ? "Varyant" : "Ürün bilgisi"}</AdminBadge>
          </p>
          <p className="text-xs text-slate-500">Kod: <span className="font-mono">{attribute.code}</span>{attribute.productCount ? ` · ${attribute.productCount} üründe kullanılıyor` : " · henüz kullanılmıyor"}</p>
        </div>
        <div role="tablist" className="-mb-px flex w-full gap-1 sm:w-auto">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={`border-b-2 px-3 py-2.5 text-sm ${tab === t.key ? "border-[#7367f0] font-semibold text-[#5b4fe0]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{t.label}</button>
          ))}
        </div>
      </div>
      {tab === "general" ? <AttributeForm initial={attribute} role={attribute.isVariantAxis ? "variant" : "spec"} onSaved={() => router.refresh()} onDeleted={onDeleted} embedded /> : null}
      {/* re-keyed on the value list: values added on the server appear without a stale row state */}
      {tab === "values" ? <OptionsEditor key={attribute.options.map((o) => o.id).join()} attribute={attribute} /> : null}
      {tab === "categories" ? <CategoriesEditor attribute={attribute} categories={categories} /> : null}
    </AdminCard>
  );
}

function AttributeForm({ initial, role: initialRole, onSaved, onDeleted, embedded = false }: { initial: AttributeRow | null; role: AttributeRole; onSaved: (id: string) => void; onDeleted?: () => void; embedded?: boolean }) {
  const [f, setF] = useState<AttributeInput>(initial
    ? { label: initial.label, code: initial.code, dataType: initial.dataType, unit: initial.unit, description: initial.description, isVariantAxis: initial.isVariantAxis, isFilterable: initial.isFilterable, displayStyle: initial.displayStyle, variesMedia: initial.variesMedia }
    : blank(initialRole));
  const [values, setValues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const errors = useFieldErrors();
  const locked = !!initial && initial.productCount > 0;
  const role: AttributeRole = f.isVariantAxis ? "variant" : "spec";
  const set = (p: Partial<AttributeInput>) => setF((s) => {
    const n = { ...s, ...p };
    if (n.isVariantAxis) n.dataType = "select";
    else n.variesMedia = false;
    if (n.dataType !== "select") n.displayStyle = "button";
    return n;
  });
  const withValues = f.dataType === "select" || f.dataType === "multiselect";

  const save = async () => {
    setBusy(true);
    errors.clear();
    try {
      if (initial) {
        await attributesApi.update(initial.id, f);
        notify.success("Özellik güncellendi");
        onSaved(initial.id);
      } else {
        const r = await attributesApi.create({ ...f, options: withValues ? values.map((label) => ({ label })) : [] });
        notify.success("Özellik eklendi", { description: values.length && withValues ? `${values.length} değerle` : undefined });
        onSaved(r.data.id);
      }
    } catch (e) {
      const n = errors.fromError(e);
      notify.error(e, { description: n ? "İşaretli alanları kontrol edin." : undefined });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    try {
      await attributesApi.remove(initial.id);
      notify.success("Özellik silindi", { description: initial.label });
      onDeleted?.();
    } catch (e) {
      notify.error(e);
    } finally {
      setConfirm(false);
    }
  };

  const body = (
    <>
      <div className="space-y-5 p-5">
        <fieldset>
          <legend className={labelCls}>Bu özellik ne işe yarıyor?{locked ? <span className="font-normal text-slate-400"> — ürünlerde kullanıldığı için değiştirilemez</span> : null}</legend>
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
            {(["variant", "spec"] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={role === r} disabled={locked && role !== r} onClick={() => set({ isVariantAxis: r === "variant" })}
                className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition disabled:opacity-40 ${role === r ? "border-[#7367f0] bg-[#7367f0]/5 ring-1 ring-[#7367f0]/30" : "border-slate-200 hover:bg-slate-50"}`}>
                <span className={`mt-0.5 grid size-5 flex-none place-items-center rounded-full border ${role === r ? "border-[#7367f0] bg-[#7367f0] text-white" : "border-slate-300"}`}>{role === r ? <Check className="size-3" /> : null}</span>
                <span><span className="block text-sm font-semibold text-slate-800">{ATTRIBUTE_ROLES[r].label}</span><span className="block text-xs text-slate-500">{ATTRIBUTE_ROLES[r].hint}</span><span className="mt-0.5 block text-xs text-slate-400">Örn. {ATTRIBUTE_ROLES[r].examples}</span></span>
              </button>
            ))}
          </div>
          {role === "spec" ? <p className="mt-2 text-xs text-slate-500">İpucu: Bilgisayarda disk kapasitesi, telefonda hafıza gibi fiyatı ve görseli tamamen değiştiren farklar ayrı ürün olarak açılır; burada ürün bilgisi olarak tanımlanır.</p> : null}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="at-label" label="Ad" required error={errors.get("label")}><input id="at-label" className={inputCls} value={f.label} maxLength={60} placeholder={role === "variant" ? "Numara" : "Materyal"} onChange={(e) => set({ label: e.target.value })} /></Field>
          <Field id="at-unit" label="Birim" hint="cm, m², g, ml … (isteğe bağlı)" error={errors.get("unit")}><input id="at-unit" className={inputCls} value={f.unit ?? ""} maxLength={12} onChange={(e) => set({ unit: e.target.value || null })} /></Field>
        </div>

        {role === "spec" ? (
          <fieldset>
            <legend className={labelCls}>Nasıl girilecek?{locked ? <span className="font-normal text-slate-400"> — kullanıldığı için değiştirilemez</span> : null}</legend>
            <div role="radiogroup" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {SPEC_TYPES.map((t) => (
                <button key={t} type="button" role="radio" aria-checked={f.dataType === t} disabled={locked && f.dataType !== t} onClick={() => set({ dataType: t })}
                  className={`rounded-xl border px-3 py-2 text-left transition disabled:opacity-40 ${f.dataType === t ? "border-[#7367f0] bg-[#7367f0]/5 ring-1 ring-[#7367f0]/30" : "border-slate-200 hover:bg-slate-50"}`}>
                  <span className="block text-sm font-medium text-slate-800">{ATTRIBUTE_TYPES[t].label}</span>
                  <span className="block text-[11px] leading-snug text-slate-500">{ATTRIBUTE_TYPES[t].hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
        ) : (
          <>
            <fieldset>
              <legend className={labelCls}>Ürün sayfasında nasıl seçilsin?</legend>
              <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(DISPLAY_STYLES) as DisplayStyle[]).map((d) => (
                  <button key={d} type="button" role="radio" aria-checked={f.displayStyle === d} onClick={() => set({ displayStyle: d })}
                    className={`rounded-xl border px-3 py-2.5 text-left transition ${f.displayStyle === d ? "border-[#7367f0] bg-[#7367f0]/5 ring-1 ring-[#7367f0]/30" : "border-slate-200 hover:bg-slate-50"}`}>
                    <StylePreview style={d} />
                    <span className="mt-2 block text-sm font-medium text-slate-800">{DISPLAY_STYLES[d].label}</span>
                    <span className="block text-[11px] text-slate-500">{DISPLAY_STYLES[d].hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <Toggle checked={!!f.variesMedia} onChange={(v) => set({ variesMedia: v })} icon={<Images className="size-4" />}
              title="Görseller bu seçeneğe göre değişsin" hint="Renk gibi: ürün düzenleyicide her değere ayrı fotoğraf yüklenir, müşteri seçince galeri değişir. Beden, numara gibi seçeneklerde kapalı kalsın." />
          </>
        )}

        <Toggle checked={f.isFilterable} onChange={(v) => set({ isFilterable: v })} title="Mağaza filtresinde göster" hint="Listelemede “Numara: 38, 39” gibi filtre olarak çıkar." />
        <Field id="at-desc" label="Açıklama (isteğe bağlı)" hint="Ekip için not, ör. “Halılarda kısa kenar × uzun kenar”."><input id="at-desc" className={inputCls} value={f.description ?? ""} maxLength={300} onChange={(e) => set({ description: e.target.value || null })} /></Field>

        {!initial && withValues ? (
          <div>
            <p className={labelCls}>Değerler <span className="font-normal text-slate-400">— yazıp Enter&apos;a basın veya virgülle ayırarak yapıştırın; renk kodu ve sıralama sonra eklenir</span></p>
            <ChipInput values={values} onChange={setValues} placeholder={role === "variant" ? "36, 37, 38, 39, 40" : "Pamuk, Polyester"} />
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
        {initial ? (
          <button type="button" onClick={() => setConfirm(true)} disabled={initial.productCount > 0} title={initial.productCount ? "Ürünlerde kullanılıyor; silinemez" : undefined}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"><Trash2 className="size-4" />Sil</button>
        ) : <span />}
        <button type="button" onClick={save} disabled={busy || f.label.trim().length < 2} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-50">
          {initial ? <Save className="size-4" /> : <Plus className="size-4" />}{busy ? (initial ? "Güncelleniyor…" : "Ekleniyor…") : initial ? "Güncelle" : "Özelliği ekle"}
        </button>
      </div>
      <AdminConfirmDialog open={confirm} title="Özellik silinsin mi?" description={initial ? `“${initial.label}” ve değerleri silinir.` : undefined} confirmLabel="Evet, sil" onConfirm={remove} onCancel={() => setConfirm(false)} />
    </>
  );
  if (embedded) return body;
  return (
    <AdminCard>
      <AdminCardTitle title={role === "variant" ? "Yeni varyant özelliği" : "Yeni ürün bilgisi"} subtitle="Önce ne işe yarayacağını seçin; hazır şablonlar soldaki listede." />
      {body}
    </AdminCard>
  );
}

function OptionsEditor({ attribute }: { attribute: AttributeRow }) {
  const router = useRouter();
  const [rows, setRows] = useState(attribute.options.map((o) => ({ ...o, numeric: o.numericValue == null ? "" : String(o.numericValue).replace(".", ",") })));
  const [adding, setAdding] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const colors = attribute.displayStyle === "swatch" || rows.some((r) => r.colorHex);
  const dirtyIds = rows.filter((r) => {
    const o = attribute.options.find((x) => x.id === r.id)!;
    const num = r.numeric.trim() ? Number(r.numeric.replace(",", ".")) : null;
    return o.label !== r.label || (o.colorHex ?? "") !== (r.colorHex ?? "") || o.isActive !== r.isActive || o.numericValue !== num;
  }).map((r) => r.id);
  const orderChanged = rows.map((r) => r.id).join() !== attribute.options.map((o) => o.id).join();
  const patchRow = (id: string, p: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const add = async () => {
    if (!adding.length) return;
    setBusy(true);
    try {
      await attributesApi.addOptions(attribute.id, adding.map((label) => ({ label })));
      notify.success(`${adding.length} değer eklendi`);
      setAdding([]);
      router.refresh();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  const saveAll = async () => {
    setBusy(true);
    try {
      for (const id of dirtyIds) {
        const r = rows.find((x) => x.id === id)!;
        await attributesApi.updateOption(attribute.id, id, { label: r.label, colorHex: r.colorHex || null, numericValue: r.numeric.trim() ? Number(r.numeric.replace(",", ".")) : null, isActive: r.isActive });
      }
      if (orderChanged) await attributesApi.reorder(attribute.id, rows.map((r) => r.id));
      notify.success("Değerler güncellendi");
      router.refresh();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await attributesApi.removeOption(attribute.id, id);
      setRows((rs) => rs.filter((r) => r.id !== id));
      router.refresh();
    } catch (e) {
      notify.error(e);
    }
  };
  const move = (i: number, d: -1 | 1) => setRows((rs) => {
    const n = [...rs];
    const j = i + d;
    if (j < 0 || j >= n.length) return rs;
    [n[i], n[j]] = [n[j]!, n[i]!];
    return n;
  });
  const sortNumeric = () => setRows((rs) => [...rs].sort((a, b) => (Number(a.numeric.replace(",", ".")) || 0) - (Number(b.numeric.replace(",", ".")) || 0) || a.label.localeCompare(b.label, "tr")));
  const sortAlpha = () => setRows((rs) => [...rs].sort((a, b) => a.label.localeCompare(b.label, "tr", { numeric: true })));

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1"><ChipInput values={adding} onChange={setAdding} placeholder="Yeni değer yazıp Enter'a basın (41, 42 …)" /></div>
        <button type="button" onClick={add} disabled={busy || !adding.length} className="inline-flex min-h-10 flex-none items-center gap-1.5 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"><Plus className="size-4" />{adding.length ? `${adding.length} değer ekle` : "Ekle"}</button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Kullanılan değer silinemez; pasif yapılırsa mevcut varyantlarda kalır, yenilerde çıkmaz. “Sayısal” değer sıralama ve aralık filtresi içindir (38,5 · 6 m²).</p>
        <span className="flex gap-1.5">
          <button type="button" onClick={sortAlpha} className="h-8 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">A→Z sırala</button>
          {rows.some((r) => r.numeric.trim()) ? <button type="button" onClick={sortNumeric} className="h-8 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Sayıya göre sırala</button> : null}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="w-16 px-3 py-2 font-medium">Sıra</th><th className="px-3 py-2 font-medium">Değer</th>{colors ? <th className="w-36 px-3 py-2 font-medium">Renk</th> : null}<th className="w-28 px-3 py-2 font-medium">Sayısal</th><th className="w-16 px-3 py-2 font-medium">Aktif</th><th className="w-24 px-3 py-2 font-medium">Kullanım</th><th className="w-12" /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`border-t border-slate-100 ${r.isActive ? "" : "bg-slate-50/70 text-slate-400"}`}>
                <td className="px-2 py-1.5"><span className="flex gap-0.5">
                  <button type="button" aria-label="Yukarı" onClick={() => move(i, -1)} className="grid size-7 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ArrowUp className="size-3.5" /></button>
                  <button type="button" aria-label="Aşağı" onClick={() => move(i, 1)} className="grid size-7 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ArrowDown className="size-3.5" /></button>
                </span></td>
                <td className="px-3 py-1.5"><input aria-label="Değer" className={`${inputCls} h-9`} value={r.label} maxLength={60} onChange={(e) => patchRow(r.id, { label: e.target.value })} /></td>
                {colors ? (
                  <td className="px-3 py-1.5"><span className="flex items-center gap-2">
                    <input type="color" aria-label="Renk" value={r.colorHex ?? "#000000"} onChange={(e) => patchRow(r.id, { colorHex: e.target.value.toUpperCase() })} className="h-9 w-10 cursor-pointer rounded border border-slate-200" />
                    <span className="font-mono text-xs">{r.colorHex ?? "—"}</span>
                  </span></td>
                ) : null}
                <td className="px-3 py-1.5"><input aria-label="Sayısal değer" inputMode="decimal" className={`${inputCls} h-9`} value={r.numeric} placeholder="—" onChange={(e) => patchRow(r.id, { numeric: e.target.value })} /></td>
                <td className="px-3 py-1.5"><input type="checkbox" aria-label="Aktif" className="size-4 accent-[#7367f0]" checked={r.isActive} onChange={(e) => patchRow(r.id, { isActive: e.target.checked })} /></td>
                <td className="px-3 py-1.5 text-xs tabular-nums text-slate-500">{r.usage ? `${r.usage} kayıt` : "—"}</td>
                <td className="px-2 py-1.5">{r.usage === 0 ? <button type="button" aria-label={`${r.label} sil`} onClick={() => remove(r.id)} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button> : null}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">Henüz değer yok; yukarıdan ekleyin.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={saveAll} disabled={busy || (!dirtyIds.length && !orderChanged)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-50">
          <Save className="size-4" />Güncelle{dirtyIds.length || orderChanged ? ` (${dirtyIds.length + (orderChanged ? 1 : 0)})` : ""}
        </button>
      </div>
    </div>
  );
}

function CategoriesEditor({ attribute, categories }: { attribute: AttributeRow; categories: Category[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState(new Map(attribute.categories.map((c) => [c.categoryId, c.isRequired])));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => categories.filter((c) => !q.trim() || fold(`${c.hint ?? ""} ${c.label}`).includes(fold(q.trim()))), [categories, q]);
  const dirty = JSON.stringify([...picked.entries()].sort()) !== JSON.stringify(attribute.categories.map((c) => [c.categoryId, c.isRequired]).sort());

  const save = async () => {
    setBusy(true);
    try {
      await attributesApi.setCategories(attribute.id, [...picked.entries()].map(([categoryId, isRequired]) => ({ categoryId, isRequired })));
      notify.success("Kategoriler güncellendi");
      router.refresh();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 p-5">
      <p className="text-xs text-slate-500">Seçili kategorilerdeki ürünlerde önerilir; “zorunlu” ise ürün bu {attribute.isVariantAxis ? "seçenek (varyant olarak)" : "bilgi"} olmadan kaydedilemez (alt kategoriler dahil).</p>
      <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3">
        <Search className="size-4 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Kategori ara" aria-label="Kategori ara" className="h-9 w-full bg-transparent text-sm outline-none" />
      </label>
      <ul className="max-h-80 divide-y divide-slate-50 overflow-y-auto rounded-xl border border-slate-200">
        {list.map((c) => {
          const on = picked.has(c.id);
          return (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <button type="button" aria-pressed={on} aria-label={c.label} onClick={() => setPicked((m) => { const n = new Map(m); if (on) n.delete(c.id); else n.set(c.id, false); return n; })}
                className={`grid size-5 place-items-center rounded border ${on ? "border-[#7367f0] bg-[#7367f0] text-white" : "border-slate-300"}`}>{on ? <Check className="size-3.5" /> : null}</button>
              <span className="min-w-0 flex-1 truncate">{c.hint ? <span className="text-slate-400">{c.hint} › </span> : null}{c.label}</span>
              {on ? (
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" className="size-3.5 accent-[#7367f0]" checked={picked.get(c.id)} onChange={(e) => setPicked((m) => new Map(m).set(c.id, e.target.checked))} />zorunlu
                </label>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{picked.size} kategori seçili</p>
        <button type="button" onClick={save} disabled={busy || !dirty} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#7367f0] px-3 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-50"><Save className="size-4" />Güncelle</button>
      </div>
    </div>
  );
}

function BarcodeCard({ initial }: { initial: { prefix: string; nextValue: number } }) {
  const router = useRouter();
  const [prefix, setPrefix] = useState(initial.prefix);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await attributesApi.setBarcodePrefix(prefix.trim());
      notify.success("Barkod öneki güncellendi");
      router.refresh();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AdminCard>
      <AdminCardTitle title="Barkod üretimi" subtitle="Ürün düzenleyicideki “Barkod üret” bu önekle tekil EAN-13 verir." />
      <div className="space-y-3 p-4">
        <Field id="bc-prefix" label="Barkod öneki" hint={`2 ile başlayan önekler mağaza içi kullanım içindir; GS1 Türkiye firma önekiniz varsa onu yazın. Sıradaki numara: ${initial.nextValue}.`}>
          <input id="bc-prefix" className={`${inputCls} font-mono`} inputMode="numeric" maxLength={10} value={prefix} onChange={(e) => setPrefix(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <button type="button" onClick={save} disabled={busy || prefix === initial.prefix || !/^\d{3,10}$/.test(prefix)} className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Barcode className="size-4" />Güncelle</button>
      </div>
    </AdminCard>
  );
}

// --- small building blocks ----------------------------------------------------
function Toggle({ checked, onChange, title, hint, icon }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint: string; icon?: React.ReactNode }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ${checked ? "border-[#7367f0]/60 bg-[#7367f0]/5" : "border-slate-200"}`}>
      <input type="checkbox" className="mt-0.5 size-4 accent-[#7367f0]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">{icon}{title}</span><span className="block text-xs text-slate-500">{hint}</span></span>
    </label>
  );
}

/** Values as chips: type + Enter / comma, paste a list, Backspace removes the last one. */
function ChipInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState("");
  const push = (raw: string) => {
    const add = splitValues(raw).filter((v) => !values.some((x) => fold(x) === fold(v)));
    if (add.length) onChange([...values, ...add].slice(0, 200));
    setText("");
  };
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-[10px] border border-slate-200 bg-white px-2 py-1.5 focus-within:border-[#7367f0] focus-within:ring-2 focus-within:ring-[#7367f0]/15">
      {values.map((v) => (
        <span key={v} className="inline-flex h-7 items-center gap-1 rounded-md bg-[#7367f0]/10 pl-2 pr-1 text-xs font-medium text-[#5b4fe0]">
          {v}<button type="button" aria-label={`${v} kaldır`} onClick={() => onChange(values.filter((x) => x !== v))} className="grid size-5 place-items-center rounded hover:bg-[#7367f0]/20"><X className="size-3" /></button>
        </span>
      ))}
      <input aria-label="Değer ekle" value={text} placeholder={values.length ? "" : placeholder} className="h-7 min-w-32 flex-1 bg-transparent px-1 text-sm outline-none"
        onChange={(e) => (/[,;\n]/.test(e.target.value) ? push(e.target.value) : setText(e.target.value))}
        onPaste={(e) => { const t = e.clipboardData.getData("text"); if (/[,;\n]/.test(t)) { e.preventDefault(); push(text + t); } }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); push(text); }
          else if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
        }}
        onBlur={() => text.trim() && push(text)} />
    </div>
  );
}

function StylePreview({ style }: { style: DisplayStyle }) {
  if (style === "swatch") return <span className="flex gap-1">{["#111111", "#DC2626", "#2563EB", "#E7D8BE"].map((c) => <span key={c} className="size-5 rounded-full ring-1 ring-slate-200" style={{ background: c }} />)}</span>;
  if (style === "dropdown") return <span className="flex h-6 w-28 items-center justify-between rounded border border-slate-300 bg-white px-1.5 text-[10px] text-slate-500">160×230 cm <ArrowDown className="size-3" /></span>;
  return <span className="flex gap-1">{["38", "39", "40"].map((c) => <span key={c} className="grid h-6 w-7 place-items-center rounded border border-slate-300 bg-white text-[10px] font-medium text-slate-600">{c}</span>)}</span>;
}
