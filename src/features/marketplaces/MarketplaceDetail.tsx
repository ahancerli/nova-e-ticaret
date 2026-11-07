"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, PlugZap, RefreshCw, Trash2 } from "lucide-react";
import { notify } from "@/lib/toast";
import { AdminConfirmDialog } from "@/components/admin/AdminConfirmDialog";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader, AdminStatCard } from "@/components/admin/ui";
import type { TargetOption } from "@/features/campaigns/TargetPicker";
import type { AttributeRow } from "@/modules/catalog/domain/attribute";
import { MARKETPLACES } from "@/modules/marketplaces/domain/marketplace";
import type { ConnectionDetail } from "@/modules/marketplaces";
import { marketplacesApi } from "./api";
import { ConnectionForm } from "./ConnectionForm";
import { MappingPanel } from "./MappingPanel";
import { ListingsPanel, OrdersPanel } from "./ListingsPanel";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const TABS = [
  { key: "general", label: "Genel" },
  { key: "mapping", label: "Eşleştirme" },
  { key: "listings", label: "Ürünler" },
  { key: "orders", label: "Siparişler" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export interface CatalogRefs {
  categories: TargetOption[];
  brands: TargetOption[];
  products: TargetOption[];
  attributes: AttributeRow[];
}

/** One marketplace connection: settings & status, mappings, listed products, imported orders. */
export function MarketplaceDetail({ detail, refs }: { detail: ConnectionDetail; refs: CatalogRefs }) {
  const router = useRouter();
  const c = detail.connection;
  const st = detail.stats;
  const [tab, setTab] = useState<Tab>("general");
  const [busy, setBusy] = useState<"" | "test" | "sync" | "delete">("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function test() {
    setBusy("test");
    try {
      await marketplacesApi.test(c.id);
      notify.success(`${MARKETPLACES[c.provider].label} bağlantısı çalışıyor`);
    } catch (err) {
      notify.error(err, { fallback: "Bağlantı denenemedi." });
    } finally {
      setBusy("");
    }
  }

  async function syncNow() {
    setBusy("sync");
    try {
      const r = (await marketplacesApi.sync(c.id, ["orders", "stock", "price", "content"])).data;
      const rep = r.report;
      notify.success("Senkron tamamlandı", {
        description: rep ? `${rep.content} ürün bilgisi, ${rep.stock} stok, ${rep.price} fiyat gönderildi · ${rep.ordersPulled} paket çekildi, ${r.imported} sipariş aktarıldı${r.failed ? `, ${r.failed} hatalı` : ""}.${rep.errors.length ? ` Hata: ${rep.errors[0]}` : ""}` : undefined,
      });
      router.refresh();
    } catch (err) {
      notify.error(err, { fallback: "Senkron çalıştırılamadı." });
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      await marketplacesApi.remove(c.id);
      notify.success("Bağlantı silindi");
      router.push("/admin/entegrasyonlar/pazaryerleri");
    } catch (err) {
      notify.error(err, { fallback: "Bağlantı silinemedi." });
      setBusy("");
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/entegrasyonlar/pazaryerleri" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Pazaryerleri</Link>
      <AdminPageHeader
        title={c.name}
        subtitle={`${MARKETPLACES[c.provider].label} · Satıcı ${c.sellerId} · ${c.environment === "stage" ? "test ortamı" : "canlı"}${c.lastSyncAt ? ` · son senkron ${dt.format(new Date(c.lastSyncAt))}` : ""}`}
        actions={<>
          <button type="button" onClick={test} disabled={!!busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <PlugZap className="h-4 w-4" /> {busy === "test" ? "Deneniyor…" : "Bağlantıyı test et"}
          </button>
          <button type="button" onClick={syncNow} disabled={!!busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df] disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${busy === "sync" ? "animate-spin" : ""}`} /> {busy === "sync" ? "Senkronize ediliyor…" : "Şimdi senkronize et"}
          </button>
        </>}
      />

      {c.lastError ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Son hata: {c.lastError}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStatCard label="Listelenen varyant" value={String(st.listings)} hint={`${st.approved} satışta · ${st.waiting} onay bekliyor`} />
        <AdminStatCard label="Sorunlu ürün" value={String(st.errors + st.rejected)} hint={`${st.rejected} reddedildi · ${st.errors} hata`} />
        <AdminStatCard label="Kuyrukta" value={String(st.queued.content + st.queued.stock + st.queued.price)} hint={`${st.queued.content} bilgi · ${st.queued.stock} stok · ${st.queued.price} fiyat · ${st.openBatches} açık batch`} />
        <AdminStatCard label="Aktarılan sipariş" value={String(st.orders.imported)} hint={st.orders.failed ? `${st.orders.failed} paket hatalı` : "Hatalı paket yok"} />
      </div>

      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.key} role="tab" type="button" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${tab === t.key ? "border-[#7367f0] text-[#5b4fe0]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "general" ? (
        <div className="space-y-6">
          <AdminCard>
            <AdminCardTitle title="Bağlantı ayarları" actions={<AdminBadge tone={c.isActive ? "green" : "slate"}>{c.isActive ? "Otomatik senkron açık" : "Pasif"}</AdminBadge>} />
            <div className="p-5"><ConnectionForm key={c.updatedAt} initial={c} /></div>
          </AdminCard>
          <AdminCard>
            <AdminCardTitle title="Kuyruk ve zamanlama" subtitle="Mağazadaki her ürün, stok, fiyat ve görsel değişikliği otomatik olarak kuyruğa düşer; her tür kendi aralığında gönderilir." />
            <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="text-xs text-slate-500">Kuyruk</dt><dd className="font-medium text-slate-800">{detail.bus.kind === "kafka" ? "Kafka (REST Proxy)" : "Veritabanı kuyruğu"} · <span className={detail.bus.ok ? "text-emerald-700" : "text-red-600"}>{detail.bus.ok ? "çalışıyor" : "erişilemiyor"}</span></dd><dd className="text-xs text-slate-500">{detail.bus.detail}</dd></div>
              {(["orders", "stock", "price", "content"] as const).map((k) => (
                <div key={k}><dt className="text-xs text-slate-500">{{ orders: "Sonraki sipariş çekimi", stock: "Sonraki stok gönderimi", price: "Sonraki fiyat gönderimi", content: "Sonraki ürün bilgisi gönderimi" }[k]}</dt>
                  <dd className="font-medium text-slate-800">{c.next[k] ? dt.format(new Date(c.next[k]!)) : "İlk çalıştırmada"}</dd></div>
              ))}
              <div><dt className="text-xs text-slate-500">Siparişler şu ana kadar çekildi</dt><dd className="font-medium text-slate-800">{c.ordersSyncedUntil ? dt.format(new Date(c.ordersSyncedUntil)) : "Henüz çekilmedi"}</dd></div>
            </dl>
          </AdminCard>
          <AdminCard className="border-red-100">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div><p className="font-medium text-slate-900">Bağlantıyı sil</p><p className="text-xs text-slate-500">Eşleştirmeler, ürün listesi ve sipariş kaydı silinir. Aktarılmış siparişler sipariş sisteminde kalır.</p></div>
              <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-medium text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /> Sil</button>
            </div>
          </AdminCard>
        </div>
      ) : null}
      {tab === "mapping" ? <MappingPanel detail={detail} refs={refs} /> : null}
      {tab === "listings" ? <ListingsPanel connectionId={c.id} products={refs.products} /> : null}
      {tab === "orders" ? <OrdersPanel connectionId={c.id} /> : null}

      <AdminConfirmDialog open={confirmDelete} title="Bağlantı silinsin mi?" description={`${c.name} bağlantısı ve API anahtarları silinecek.`}
        confirmLabel="Evet, sil" busyLabel="Siliniyor…" busy={busy === "delete"} onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
    </div>
  );
}
