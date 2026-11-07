"use client";

import Link from "next/link";
import { ChevronRight, Store } from "lucide-react";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader } from "@/components/admin/ui";
import { MARKETPLACES, MARKETPLACE_KEYS, type ConnectionRow, type ConnectionStats } from "@/modules/marketplaces/domain/marketplace";
import { ConnectionForm } from "./ConnectionForm";

const dt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

/** Entegrasyonlar › Pazaryerleri: provider cards, the seller accounts connected, and a form for a new one. */
export function MarketplacesList({ connections, bus }: { connections: (ConnectionRow & { stats: ConnectionStats })[]; bus: { kind: string; ok: boolean; detail: string } }) {
  return (
    <div className="space-y-6">
      <AdminPageHeader title="Pazaryerleri" subtitle="Ürün, stok, fiyat ve görseller kuyruk üzerinden pazaryerine gider; siparişler belirlediğiniz aralıkla tekil olarak sipariş sistemine yazılır." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {MARKETPLACE_KEYS.map((k) => {
          const m = MARKETPLACES[k];
          const count = connections.filter((c) => c.provider === k).length;
          return (
            <AdminCard key={k} className="p-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl text-white" style={{ background: m.color }}><Store className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{m.label}</p>
                  <p className="text-xs text-slate-500">{m.ready ? (count ? `${count} bağlantı` : "Hazır") : "Yakında"}</p>
                </div>
                {m.ready ? <AdminBadge tone={count ? "green" : "blue"}>{count ? "Bağlı" : "Kullanılabilir"}</AdminBadge> : <AdminBadge>Yakında</AdminBadge>}
              </div>
              <p className="mt-3 text-xs text-slate-500">{m.hint}</p>
            </AdminCard>
          );
        })}
      </div>

      <AdminCard>
        <AdminCardTitle title="Bağlantılar" subtitle={`Kuyruk: ${bus.kind === "kafka" ? "Kafka (REST Proxy)" : "Veritabanı kuyruğu"} · ${bus.ok ? "çalışıyor" : "erişilemiyor"} — ${bus.detail}`} />
        {connections.length ? (
          <ul className="divide-y divide-slate-100">
            {connections.map((c) => (
              <li key={c.id}>
                <Link href={`/admin/entegrasyonlar/pazaryerleri/${c.id}`} className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-slate-50">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: MARKETPLACES[c.provider].color }} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{c.name} <span className="text-xs font-normal text-slate-500">· {MARKETPLACES[c.provider].label} · Satıcı {c.sellerId}{c.environment === "stage" ? " · test ortamı" : ""}</span></p>
                    <p className="text-xs text-slate-500">
                      {c.stats.listings} varyant · {c.stats.approved} satışta · {c.stats.waiting} onay bekliyor · {c.stats.orders.imported} sipariş
                      {c.lastSyncAt ? ` · son senkron ${dt.format(new Date(c.lastSyncAt))}` : ""}
                    </p>
                  </div>
                  {c.lastError ? <AdminBadge tone="red">Hata var</AdminBadge> : null}
                  {c.stats.errors || c.stats.rejected ? <AdminBadge tone="amber">{c.stats.errors + c.stats.rejected} sorunlu ürün</AdminBadge> : null}
                  <AdminBadge tone={c.isActive ? "green" : "slate"}>{c.isActive ? "Aktif" : "Pasif"}</AdminBadge>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Henüz bağlantı yok. Aşağıdan Trendyol satıcı hesabınızı ekleyin.</p>
        )}
      </AdminCard>

      <AdminCard>
        <AdminCardTitle title="Yeni bağlantı" subtitle="Trendyol Satıcı Paneli › Hesap Bilgilerim › Entegrasyon Bilgileri sayfasındaki Satıcı ID, API Key ve API Secret." />
        <div className="p-5"><ConnectionForm initial={null} /></div>
      </AdminCard>
    </div>
  );
}
