"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { notify } from "@/lib/toast";
import { inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import type { ConnectionDetail } from "@/modules/marketplaces";
import { marketplacesApi, type AttributeRule, type MarketAttribute, type ValueRule } from "./api";
import type { CatalogRefs } from "./MarketplaceDetail";

const fold = (s: string) => s.toLocaleLowerCase("tr-TR");

/** Debounced remote search (marketplace categories / brands). */
function useRemote<T>(fn: (q: string) => Promise<T[]>, q: string, min: number) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (q.trim().length < min) return;
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fn(q);
        if (live) setRows(r);
      } catch (err) {
        if (live) notify.error(err, { fallback: "Pazaryeri verisi alınamadı." });
      } finally {
        if (live) setLoading(false);
      }
    }, 350);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, min]);
  return { rows: q.trim().length < min ? [] : rows, loading };
}

/** Our item (category / brand) → a marketplace item picked by search. */
function MapRow({ label, hint, current, search, onSave }: {
  label: string; hint?: string; current: string | null;
  search: (q: string) => Promise<{ id: number; text: string; disabled?: boolean }[]>;
  onSave: (v: { id: number; text: string } | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { rows, loading } = useRemote(search, open ? q : "", 2);
  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900">{label}</p>
          {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
        </div>
        {current ? <AdminBadge tone="green">{current}</AdminBadge> : <AdminBadge tone="amber">Eşleşmedi</AdminBadge>}
        <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">{open ? "Kapat" : current ? "Değiştir" : "Eşleştir"}</button>
        {current ? <button type="button" onClick={() => onSave(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Eşleştirmeyi kaldır"><X className="h-4 w-4" /></button> : null}
      </div>
      {open ? (
        <div className="mt-3 space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input autoFocus className={`${inputCls} h-9 pl-9`} placeholder="En az 2 harf yazın…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`${label} için ara`} />
          </div>
          {loading ? <p className="text-xs text-slate-500">Aranıyor… (ilk aramada kategori ağacı indirilir)</p> : null}
          <ul className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" disabled={r.disabled} onClick={async () => { await onSave(r); setOpen(false); setQ(""); }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400">
                  <span>{r.text}</span><span className="text-xs text-slate-400">#{r.id}{r.disabled ? " · alt kategori seçin" : ""}</span>
                </button>
              </li>
            ))}
            {!loading && q.trim().length >= 2 && !rows.length ? <li className="px-3 py-3 text-sm text-slate-500">Sonuç yok.</li> : null}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

/** Eşleştirme: categories → leaf marketplace categories, brands → marketplace brands, attributes & values per category. */
export function MappingPanel({ detail, refs }: { detail: ConnectionDetail; refs: CatalogRefs }) {
  const router = useRouter();
  const id = detail.connection.id;
  const [filter, setFilter] = useState("");
  const catMap = useMemo(() => new Map(detail.categoryMappings.map((m) => [m.categoryId, m])), [detail.categoryMappings]);
  const brandMap = useMemo(() => new Map(detail.brandMappings.map((m) => [m.brandId, m])), [detail.brandMappings]);
  const f = fold(filter.trim());
  const cats = refs.categories.filter((c) => !f || fold(c.label).includes(f) || fold(c.hint ?? "").includes(f));
  const brands = refs.brands.filter((b) => !f || fold(b.label).includes(f));

  const save = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      notify.success(ok, { description: "Listelenen ürünlerin bilgisi yeniden gönderilmek üzere kuyruğa alındı." });
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "Eşleştirme kaydedilemedi." });
    }
  };

  const externalCats = useMemo(() => [...new Map(detail.categoryMappings.map((m) => [m.externalCategoryId, m.path])).entries()], [detail.categoryMappings]);

  return (
    <div className="space-y-6">
      <input className={`${inputCls} h-10 max-w-md`} placeholder="Kategori veya marka filtrele…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrele" />

      <AdminCard>
        <AdminCardTitle title="Kategoriler" subtitle={`${catMap.size}/${refs.categories.length} eşleşti. Trendyol yalnız en alt (yaprak) kategoriye ürün kabul eder.`} />
        <ul className="divide-y divide-slate-100">
          {cats.map((c) => (
            <MapRow key={c.id} label={c.label} hint={c.hint} current={catMap.get(c.id)?.path ?? null}
              search={async (q) => (await marketplacesApi.categories(id, q)).data.map((r) => ({ id: r.id, text: r.path, disabled: !r.isLeaf }))}
              onSave={(v) => save(marketplacesApi.mapCategory(id, c.id, v ? { id: v.id, path: v.text } : null), "Kategori eşleştirmesi kaydedildi")} />
          ))}
        </ul>
      </AdminCard>

      <AdminCard>
        <AdminCardTitle title="Markalar" subtitle={`${brandMap.size}/${refs.brands.length} eşleşti. Marka Trendyol'da yoksa önce Satıcı Paneli'nden marka başvurusu yapın.`} />
        <ul className="divide-y divide-slate-100">
          {brands.map((b) => (
            <MapRow key={b.id} label={b.label} current={brandMap.get(b.id)?.name ?? null}
              search={async (q) => (await marketplacesApi.brands(id, q)).data.map((r) => ({ id: r.id, text: r.name }))}
              onSave={(v) => save(marketplacesApi.mapBrand(id, b.id, v ? { id: v.id, name: v.text } : null), "Marka eşleştirmesi kaydedildi")} />
          ))}
        </ul>
      </AdminCard>

      <AttributeMapping detail={detail} refs={refs} externalCats={externalCats} />
    </div>
  );
}

type Source = { kind: "none" } | { kind: "attr"; attributeId: string } | { kind: "fixed"; valueId: number } | { kind: "custom"; text: string };

/** Per marketplace category: where each marketplace attribute takes its value from, and option → value for select attributes. */
function AttributeMapping({ detail, refs, externalCats }: { detail: ConnectionDetail; refs: CatalogRefs; externalCats: [number, string][] }) {
  const router = useRouter();
  const id = detail.connection.id;
  const [cat, setCat] = useState<number | null>(externalCats[0]?.[0] ?? null);
  const [attrs, setAttrs] = useState<MarketAttribute[] | null>(null);
  const [sources, setSources] = useState<Record<number, Source>>({});
  const [values, setValues] = useState<Record<string, { valueId: number | null; custom: string | null }>>({});
  const [allowed, setAllowed] = useState<Record<number, { id: number; name: string }[]>>({});
  const [saving, setSaving] = useState(false);
  const attrById = useMemo(() => new Map(refs.attributes.map((a) => [a.id, a])), [refs.attributes]);

  useEffect(() => {
    if (cat == null) return;
    let live = true;
    (async () => {
      setAttrs(null);
      try {
        const list = (await marketplacesApi.attributes(id, cat)).data;
        if (!live) return;
        const s: Record<number, Source> = {};
        for (const r of detail.attributeMappings.filter((m) => m.externalCategoryId === cat)) {
          s[r.externalAttributeId] = r.attributeId ? { kind: "attr", attributeId: r.attributeId } : r.fixedValueId ? { kind: "fixed", valueId: r.fixedValueId } : { kind: "custom", text: r.fixedCustomValue ?? "" };
        }
        const v: Record<string, { valueId: number | null; custom: string | null }> = {};
        for (const m of detail.valueMappings) v[`${m.externalAttributeId}:${m.optionId}`] = { valueId: m.valueId, custom: m.custom };
        setSources(s); setValues(v); setAttrs(list);
      } catch (err) {
        if (live) { notify.error(err, { fallback: "Kategori özellikleri alınamadı." }); setAttrs([]); }
      }
    })();
    return () => { live = false; };
  }, [cat, id, detail.attributeMappings, detail.valueMappings]);

  async function loadValues(attrId: number) {
    if (cat == null || allowed[attrId]) return;
    try {
      const r = (await marketplacesApi.values(id, cat, attrId)).data;
      setAllowed((p) => ({ ...p, [attrId]: r }));
    } catch (err) {
      notify.error(err, { fallback: "Değerler alınamadı." });
    }
  }

  async function save() {
    if (cat == null || !attrs) return;
    const rules: AttributeRule[] = [];
    const vals: ValueRule[] = [];
    for (const a of attrs) {
      const s = sources[a.id];
      if (!s || s.kind === "none") continue;
      if (s.kind === "custom" && !s.text.trim()) continue;
      rules.push({ externalAttributeId: a.id, name: a.name, attributeId: s.kind === "attr" ? s.attributeId : null, fixedValueId: s.kind === "fixed" ? s.valueId : null, fixedCustomValue: s.kind === "custom" ? s.text.trim() : null });
      if (s.kind === "attr") {
        for (const o of attrById.get(s.attributeId)?.options ?? []) {
          const v = values[`${a.id}:${o.id}`];
          if (v && (v.valueId != null || v.custom?.trim())) vals.push({ externalAttributeId: a.id, optionId: o.id, valueId: v.valueId, custom: v.valueId != null ? null : v.custom!.trim() });
        }
      }
    }
    setSaving(true);
    try {
      await marketplacesApi.mapAttributes(id, cat, rules, vals);
      notify.success("Özellik eşleştirmesi kaydedildi", { description: `${rules.length} özellik, ${vals.length} değer.` });
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "Özellik eşleştirmesi kaydedilemedi." });
    } finally {
      setSaving(false);
    }
  }

  if (!externalCats.length) {
    return <AdminCard><AdminCardTitle title="Özellikler" subtitle="Önce en az bir kategoriyi eşleştirin; özellikler Trendyol kategorisine göre belirlenir." /></AdminCard>;
  }
  const setSrc = (aid: number, s: Source) => setSources((p) => ({ ...p, [aid]: s }));

  return (
    <AdminCard>
      <AdminCardTitle title="Özellikler" subtitle="Zorunlu Trendyol özellikleri eksikse ürün gönderilmez. Renk / beden gibi varyant özelliklerini mağaza özelliğine bağlayıp değerleri eşleyin; sabit özellikler (ör. Menşei) için tek değer seçin."
        actions={<button type="button" onClick={save} disabled={saving || !attrs} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60"><Check className="h-4 w-4" /> {saving ? "Kaydediliyor…" : "Kaydet"}</button>} />
      <div className="border-b border-slate-100 px-5 py-3">
        <select className={`${inputCls} h-10`} value={cat ?? ""} onChange={(e) => { setCat(Number(e.target.value)); setAllowed({}); }} aria-label="Trendyol kategorisi">
          {externalCats.map(([extId, path]) => <option key={extId} value={extId}>{path}</option>)}
        </select>
      </div>
      {attrs === null ? <p className="px-5 py-6 text-sm text-slate-500">Özellikler yükleniyor…</p> : (
        <ul className="divide-y divide-slate-100">
          {attrs.map((a) => {
            const s = sources[a.id] ?? { kind: "none" };
            const ours = s.kind === "attr" ? attrById.get(s.attributeId) : undefined;
            return (
              <li key={a.id} className="space-y-2 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-40 flex-1 text-sm font-medium text-slate-900">{a.name} {a.required ? <AdminBadge tone="red">Zorunlu</AdminBadge> : null} {a.varianter ? <AdminBadge tone="purple">Varyant</AdminBadge> : null}</p>
                  <select className={`${inputCls} h-9 w-auto`} aria-label={`${a.name} kaynağı`} value={s.kind === "attr" ? `attr:${s.attributeId}` : s.kind}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith("attr:")) setSrc(a.id, { kind: "attr", attributeId: v.slice(5) });
                      else if (v === "fixed") { setSrc(a.id, { kind: "fixed", valueId: 0 }); void loadValues(a.id); }
                      else if (v === "custom") setSrc(a.id, { kind: "custom", text: "" });
                      else setSrc(a.id, { kind: "none" });
                    }}>
                    <option value="none">— Gönderme —</option>
                    <optgroup label="Mağaza özelliğinden">
                      {refs.attributes.map((x) => <option key={x.id} value={`attr:${x.id}`}>{x.label}{x.isVariantAxis ? " (varyant)" : ""}</option>)}
                    </optgroup>
                    <option value="fixed">Sabit Trendyol değeri</option>
                    {a.allowCustom ? <option value="custom">Sabit serbest metin</option> : null}
                  </select>
                  {s.kind === "fixed" ? (
                    <select className={`${inputCls} h-9 w-auto`} aria-label={`${a.name} değeri`} value={s.valueId || ""} onFocus={() => loadValues(a.id)} onChange={(e) => setSrc(a.id, { kind: "fixed", valueId: Number(e.target.value) })}>
                      <option value="">Değer seçin…</option>
                      {(allowed[a.id] ?? (s.valueId ? [{ id: s.valueId, name: `#${s.valueId}` }] : [])).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  ) : null}
                  {s.kind === "custom" ? <input className={`${inputCls} h-9 w-56`} aria-label={`${a.name} metni`} value={s.text} onChange={(e) => setSrc(a.id, { kind: "custom", text: e.target.value })} /> : null}
                </div>
                {ours && ours.options.length ? (
                  <div className="ml-0 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-3" onFocus={() => loadValues(a.id)}>
                    {ours.options.filter((o) => o.isActive).map((o) => {
                      const key = `${a.id}:${o.id}`;
                      const v = values[key];
                      const list = allowed[a.id];
                      return (
                        <label key={o.id} className="flex items-center gap-2 text-xs text-slate-700">
                          <span className="w-24 truncate font-medium">{o.label}</span>
                          {list && list.length ? (
                            <select className={`${inputCls} h-8 flex-1 text-xs`} value={v?.valueId ?? ""} onChange={(e) => setValues((p) => ({ ...p, [key]: { valueId: e.target.value ? Number(e.target.value) : null, custom: null } }))}>
                              <option value="">{a.allowCustom ? "Aynı metin gönderilsin" : "Seçin…"}</option>
                              {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                            </select>
                          ) : (
                            <input className={`${inputCls} h-8 flex-1 text-xs`} placeholder={list ? (a.allowCustom ? o.label : "Değer listesi yok") : "Değerler için tıklayın"} value={v?.custom ?? (v?.valueId ? `#${v.valueId}` : "")}
                              onChange={(e) => setValues((p) => ({ ...p, [key]: { valueId: null, custom: e.target.value } }))} />
                          )}
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </li>
            );
          })}
          {!attrs.length ? <li className="px-5 py-6 text-sm text-slate-500">Bu kategori için özellik yok.</li> : null}
        </ul>
      )}
    </AdminCard>
  );
}
