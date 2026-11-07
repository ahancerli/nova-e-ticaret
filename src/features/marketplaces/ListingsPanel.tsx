"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pause, Play, Plus, RefreshCw, Search } from "lucide-react";
import { notify } from "@/lib/toast";
import { formatMinor } from "@/lib/money";
import { inputCls } from "@/components/admin/form";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import type { TargetOption } from "@/features/campaigns/TargetPicker";
import { LISTING_STATUS } from "@/modules/marketplaces/domain/marketplace";
import type { ListingRow, MarketplaceOrderRow } from "@/modules/marketplaces";
import { marketplacesApi } from "./api";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const fold = (s: string) => s.toLocaleLowerCase("tr-TR");

/** Ürünler: pick products to sell on the marketplace; each variant is a listing with its own barcode and status. */
export function ListingsPanel({ connectionId, products }: { connectionId: string; products: TargetOption[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<ListingRow[] | null>(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await marketplacesApi.listings(connectionId, status || undefined, q.trim() || undefined)).data);
    } catch (err) {
      notify.error(err, { fallback: "Ürünler yüklenemedi." });
      setRows([]);
    }
  }, [connectionId, status, q]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const listedProducts = useMemo(() => new Set((rows ?? []).map((r) => r.productId)), [rows]);
  const matches = useMemo(() => {
    const s = fold(search.trim());
    return products.filter((p) => !s || fold(p.label).includes(s) || fold(p.hint ?? "").includes(s)).slice(0, 50);
  }, [products, search]);

  async function add() {
    setBusy(true);
    try {
      const r = (await marketplacesApi.addListings(connectionId, [...picked])).data;
      notify.success(`${r.added} varyant listeye eklendi`, { description: "Ürün bilgisi bir sonraki gönderimde pazaryerine iletilir. Hemen göndermek için “Şimdi senkronize et”." });
      setPicked(new Set());
      await load();
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "Ürünler eklenemedi." });
    } finally {
      setBusy(false);
    }
  }

  async function pause(paused: boolean) {
    setBusy(true);
    try {
      await marketplacesApi.pauseListings(connectionId, [...selected], paused);
      notify.success(paused ? "Satış durduruldu (stok 0 gönderilir)" : "Satış yeniden açıldı");
      setSelected(new Set());
      await load();
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "Güncellenemedi." });
    } finally {
      setBusy(false);
    }
  }

  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  return (
    <div className="space-y-6">
      <AdminCard>
        <AdminCardTitle title="Ürün ekle" subtitle="Seçilen ürünlerin tüm aktif varyantları listelenir. Her varyantın barkodu olmalı; kategori ve marka eşleştirmesi yapılmış olmalı." />
        <div className="space-y-3 p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className={`${inputCls} h-10 pl-9`} placeholder="Ürün ara…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Ürün ara" />
          </div>
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {matches.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={picked.has(p.id)} onChange={() => setPicked((s) => toggle(s, p.id))} />
                  <span className="min-w-0 flex-1 truncate">{p.label} {p.hint ? <span className="text-xs text-slate-500">· {p.hint}</span> : null}</span>
                  {listedProducts.has(p.id) ? <AdminBadge tone="green">Listede</AdminBadge> : null}
                </label>
              </li>
            ))}
            {!matches.length ? <li className="px-3 py-4 text-center text-sm text-slate-500">Ürün bulunamadı.</li> : null}
          </ul>
          <div className="flex justify-end">
            <button type="button" disabled={!picked.size || busy} onClick={add}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-50">
              <Plus className="h-4 w-4" /> {picked.size ? `${picked.size} ürünü listele` : "Ürün seçin"}
            </button>
          </div>
        </div>
      </AdminCard>

      <AdminCard>
        <AdminCardTitle title="Listelenen varyantlar" actions={<>
          <button type="button" disabled={!selected.size || busy} onClick={() => pause(true)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Pause className="h-4 w-4" /> Durdur</button>
          <button type="button" disabled={!selected.size || busy} onClick={() => pause(false)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Play className="h-4 w-4" /> Devam ettir</button>
          <button type="button" onClick={load} className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-2.5 text-slate-600 hover:bg-slate-50" aria-label="Yenile"><RefreshCw className="h-4 w-4" /></button>
        </>} />
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3">
          <select className={`${inputCls} h-9 w-auto`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Durum">
            <option value="">Tüm durumlar</option>
            {Object.entries(LISTING_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input className={`${inputCls} h-9 w-64`} placeholder="Ürün, SKU, barkod…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Listede ara" />
        </div>
        {rows === null ? <p className="px-5 py-8 text-center text-sm text-slate-500">Yükleniyor…</p> : rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-10 px-5 py-2"><input type="checkbox" aria-label="Tümünü seç" checked={selected.size === rows.length} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.variantId)) : new Set())} /></th>
                  <th className="px-3 py-2">Ürün / varyant</th><th className="px-3 py-2">SKU · Barkod</th><th className="px-3 py-2">Durum</th><th className="px-3 py-2">Son gönderim</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const s = LISTING_STATUS[r.status] ?? { label: r.status, tone: "slate" as const };
                  return (
                    <tr key={r.variantId} className="align-top">
                      <td className="px-5 py-3"><input type="checkbox" aria-label={`${r.productName} seç`} checked={selected.has(r.variantId)} onChange={() => setSelected((x) => toggle(x, r.variantId))} /></td>
                      <td className="px-3 py-3">
                        <Link href={`/admin/urunler/${r.productId}`} className="font-medium text-slate-900 hover:underline">{r.productName}</Link>
                        {r.variantLabel ? <p className="text-xs text-slate-500">{r.variantLabel}</p> : null}
                        {r.lastError ? <p className="mt-1 max-w-xl whitespace-pre-line text-xs text-red-600">{r.lastError}</p> : null}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs text-slate-600">{r.sku}<br />{r.barcode ?? <span className="text-red-600">barkod yok</span>}</td>
                      <td className="px-3 py-3"><AdminBadge tone={s.tone}>{s.label}</AdminBadge>{r.contentId ? <p className="mt-1 text-xs text-slate-500">içerik #{r.contentId}</p> : null}</td>
                      <td className="px-3 py-3 text-xs text-slate-500">{r.lastPushedAt ? dt.format(new Date(r.lastPushedAt)) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="px-5 py-8 text-center text-sm text-slate-500">Listede ürün yok.</p>}
      </AdminCard>
    </div>
  );
}

const ORDER_STATUS = { imported: { label: "Aktarıldı", tone: "green" }, failed: { label: "Hatalı", tone: "red" }, skipped: { label: "Atlandı", tone: "slate" } } as const;

/** Siparişler: every package pulled from the marketplace and what happened to it. */
export function OrdersPanel({ connectionId }: { connectionId: string }) {
  const [rows, setRows] = useState<MarketplaceOrderRow[] | null>(null);
  const [status, setStatus] = useState("");
  const load = useCallback(async () => {
    try {
      setRows((await marketplacesApi.orders(connectionId, status || undefined)).data);
    } catch (err) {
      notify.error(err, { fallback: "Siparişler yüklenemedi." });
      setRows([]);
    }
  }, [connectionId, status]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <AdminCard>
      <AdminCardTitle title="Çekilen paketler" subtitle="Her paket bir kez siparişe dönüşür; sonraki durumları (kargoda, teslim edildi…) siparişe not olarak eklenir. Hatalı paketler sonraki çekişte yeniden denenir."
        actions={<>
          <select className={`${inputCls} h-9 w-auto`} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Durum">
            <option value="">Tümü</option>
            {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button type="button" onClick={load} className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-2.5 text-slate-600 hover:bg-slate-50" aria-label="Yenile"><RefreshCw className="h-4 w-4" /></button>
        </>} />
      {rows === null ? <p className="px-5 py-8 text-center text-sm text-slate-500">Yükleniyor…</p> : rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-5 py-2">Pazaryeri sipariş · paket</th><th className="px-3 py-2">Durum</th><th className="px-3 py-2">Bizdeki sipariş</th><th className="px-3 py-2">Tutar</th><th className="px-3 py-2">Güncellendi</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const s = ORDER_STATUS[r.status];
                return (
                  <tr key={r.packageId} className="align-top">
                    <td className="px-5 py-3"><p className="font-medium text-slate-900">{r.orderNumber}</p><p className="text-xs text-slate-500">paket {r.packageId}{r.externalStatus ? ` · ${r.externalStatus}` : ""}</p>
                      {r.error ? <p className="mt-1 max-w-xl text-xs text-red-600">{r.error}</p> : null}</td>
                    <td className="px-3 py-3"><AdminBadge tone={s.tone}>{s.label}</AdminBadge>{r.attempts > 1 ? <p className="mt-1 text-xs text-slate-500">{r.attempts} deneme</p> : null}</td>
                    <td className="px-3 py-3">{r.orderId && r.ourOrderNumber ? <Link href={`/admin/siparisler/${r.orderId}`} className="font-mono text-xs text-[#5b4fe0] hover:underline">{r.ourOrderNumber}</Link> : "—"}</td>
                    <td className="px-3 py-3">{r.totalMinor != null ? formatMinor(r.totalMinor) : "—"}</td>
                    <td className="px-3 py-3 text-xs text-slate-500">{dt.format(new Date(r.updatedAt))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="px-5 py-8 text-center text-sm text-slate-500">Henüz paket çekilmedi.</p>}
    </AdminCard>
  );
}
