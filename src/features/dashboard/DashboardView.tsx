import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowRight, Banknote, CheckCircle2, PackageOpen, PackageX, Truck } from "lucide-react";
import { AdminBadge, AdminCard, AdminCardTitle } from "@/components/admin/ui";
import { ORDER_STATUS, PROVIDER_LABEL, orderStatusMeta, paymentStatusMeta, type OrderStatus } from "@/lib/order-rules";
import { formatMinor } from "@/lib/money";
import type { Dashboard, PeriodKey } from "@/modules/reporting";
import { KpiTile } from "./KpiTile";
import { SalesChart } from "./SalesChart";
import { formatCount, formatDateTime, formatTry, periodRange } from "./format";

export interface DashboardViewProps {
  data: Dashboard;
  periods: { key: PeriodKey; label: string; href: string }[];
  greeting: string;
}

/** Admin home: what needs doing now, how the period went, and where to look next. */
export function DashboardView({ data, periods, greeting }: DashboardViewProps) {
  const { period, kpis, queue } = data;
  const compare = period.compareLabel;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{greeting}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {period.label} · {periodRange(period.from, period.to)} · karşılaştırma {compare}
          </p>
        </div>
        <nav aria-label="Dönem" className="grid w-full grid-cols-4 rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:inline-grid sm:w-auto">
          {periods.map((p) => (
            <Link key={p.key} href={p.href} aria-current={p.key === period.key ? "page" : undefined} scroll={false}
              className={`h-8 whitespace-nowrap rounded-lg px-3 text-center text-sm font-medium leading-8 transition ${p.key === period.key ? "bg-[#7367f0] text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>
              {p.label}
            </Link>
          ))}
        </nav>
      </header>

      <WorkQueue queue={queue} />

      <section aria-label="Özet göstergeler" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Ciro" value={formatTry(kpis.revenue.value)} kpi={kpis.revenue} compareLabel={compare} trend={data.series.map((p) => p.revenueMinor)} />
        <KpiTile label="Sipariş" value={formatCount(kpis.orders.value)} kpi={kpis.orders} compareLabel={compare} trend={data.series.map((p) => p.orders)} />
        <KpiTile label="Ortalama sepet" value={formatTry(kpis.averageOrder.value)} kpi={kpis.averageOrder} compareLabel={compare} hint="Ödemesi alınan sipariş başına" />
        <KpiTile label="İade" value={formatTry(kpis.refunds.value)} kpi={kpis.refunds} compareLabel={compare} upIsGood={false} hint="Tamamlanan iadeler" />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <AdminCard className="min-w-0">
            <SalesChart series={data.series} bucket={period.bucket} />
          </AdminCard>
          <PaymentMix mix={data.paymentMix} />
        </div>
        <div className="min-w-0">
          <StatusBreakdown counts={data.statusCounts} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RecentOrders rows={data.recent} />
        <div className="grid min-w-0 content-start gap-4">
          <TopProducts rows={data.topProducts} />
          {data.lowStock ? <LowStock rows={data.lowStock} /> : null}
        </div>
      </div>
    </div>
  );
}

const QUEUE: { key: keyof Dashboard["queue"]; label: string; href: string; icon: ComponentType<{ className?: string }>; tone: string }[] = [
  { key: "awaitingTransfer", label: "Havale onayı bekliyor", href: "/admin/siparisler?sekme=waiting", icon: Banknote, tone: "bg-amber-50 text-amber-600" },
  { key: "toPrepare", label: "Hazırlanacak", href: "/admin/siparisler?sekme=todo", icon: PackageOpen, tone: "bg-sky-50 text-sky-600" },
  { key: "toShip", label: "Kargoya verilecek", href: "/admin/siparisler?sekme=todo", icon: Truck, tone: "bg-violet-50 text-violet-600" },
  { key: "outOfStock", label: "Stokta kalmadı", href: "/admin/urunler", icon: PackageX, tone: "bg-rose-50 text-rose-600" },
];

function WorkQueue({ queue }: { queue: Dashboard["queue"] }) {
  const items = QUEUE.filter((q) => queue[q.key] !== null);
  const open = items.reduce((a, q) => a + (queue[q.key] ?? 0), 0);
  return (
    <section aria-labelledby="dash-queue">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="dash-queue" className="text-sm font-semibold text-slate-700">Bekleyen işler</h2>
        {open === 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="size-3.5" aria-hidden />Her şey yolunda</span>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map(({ key, label, href, icon: Icon, tone }) => {
          const n = queue[key] ?? 0;
          return (
            <Link key={key} href={href}
              className={`group flex items-center gap-3 rounded-2xl border bg-white px-4 py-3 shadow-sm transition hover:border-[#7367f0]/40 hover:shadow ${n > 0 ? "border-slate-200" : "border-slate-100 opacity-70"}`}>
              <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-2xl font-semibold leading-none text-slate-900">{formatCount(n)}</span>
                <span className="mt-1 block truncate text-sm text-slate-500">{label}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#7367f0]" aria-hidden />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function StatusBreakdown({ counts }: { counts: Record<string, number> }) {
  const rows = (Object.keys(ORDER_STATUS) as OrderStatus[]).map((s) => ({ status: s, n: counts[s] ?? 0 })).filter((r) => r.n > 0);
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <AdminCard className="min-w-0">
      <AdminCardTitle title="Sipariş durumları" subtitle="Dönemde verilen siparişler, bugünkü durumlarıyla" />
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">Bu dönemde sipariş yok.</p>
      ) : (
        <ul className="space-y-3 px-5 py-4">
          {rows.map((r) => (
            <li key={r.status}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{orderStatusMeta(r.status).label}</span>
                <span className="font-semibold tabular-nums text-slate-900">{formatCount(r.n)}</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-slate-100" aria-hidden>
                <div className="h-2 rounded-full bg-[#7367f0]" style={{ width: `${Math.max(2, (r.n / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminCard>
  );
}

// Categorical, fixed order (validated pair: accent violet + teal); identity also carried by the legend text.
const PROVIDER_COLOR: Record<string, string> = { iyzico: "#7367f0", bank_transfer: "#0d9488" };

function PaymentMix({ mix }: { mix: Dashboard["paymentMix"] }) {
  const total = mix.reduce((a, m) => a + m.amountMinor, 0);
  const share = (m: { amountMinor: number }) => (total > 0 ? m.amountMinor / total : 0);
  const pct = (m: { amountMinor: number }) => `%${Math.round(share(m) * 100)}`;
  return (
    <AdminCard className="min-w-0">
      <AdminCardTitle title="Ödeme yöntemleri" subtitle="Tahsil edilen tutarın dağılımı" />
      {total === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">Bu dönemde tahsilat yok.</p>
      ) : (
        <div className="px-5 py-4">
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={mix.map((m) => `${PROVIDER_LABEL[m.provider] ?? m.provider} ${pct(m)}`).join(", ")}>
            {mix.map((m) => (
              <div key={m.provider} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${share(m) * 100}%`, background: PROVIDER_COLOR[m.provider] ?? "#94a3b8" }} />
            ))}
          </div>
          <ul className="mt-4 space-y-2.5">
            {mix.map((m) => (
              <li key={m.provider} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-slate-600">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: PROVIDER_COLOR[m.provider] ?? "#94a3b8" }} aria-hidden />
                  <span className="truncate">{PROVIDER_LABEL[m.provider] ?? m.provider}</span>
                  <span className="text-xs text-slate-400">{formatCount(m.count)} ödeme</span>
                </span>
                <span className="shrink-0 tabular-nums"><strong className="font-semibold text-slate-900">{formatTry(m.amountMinor)}</strong> <span className="text-xs text-slate-500">{pct(m)}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AdminCard>
  );
}

function RecentOrders({ rows }: { rows: Dashboard["recent"] }) {
  return (
    <AdminCard className="min-w-0">
      <AdminCardTitle title="Son siparişler" subtitle="En yeni 6 sipariş"
        actions={<Link href="/admin/siparisler" className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-[#7367f0] hover:bg-[#7367f0]/10">Tümü<ArrowRight className="size-3.5" aria-hidden /></Link>} />
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">Henüz sipariş yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-slate-500">
                <th className="px-5 py-2.5 font-medium">Sipariş</th>
                <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Müşteri</th>
                <th className="px-3 py-2.5 font-medium">Durum</th>
                <th className="hidden px-5 py-2.5 text-right font-medium sm:table-cell">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = orderStatusMeta(r.status);
                const pay = paymentStatusMeta(r.paymentStatus);
                return (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-5 py-3">
                      <Link href={`/admin/siparisler/${r.id}`} className="font-semibold text-[#7367f0] hover:underline">#{r.orderNumber}</Link>
                      <p className="text-xs text-slate-500">{formatDateTime(r.placedAt)}</p>
                      <p className="mt-0.5 font-semibold tabular-nums text-slate-900 sm:hidden">{formatMinor(r.totalMinor)}</p>
                    </td>
                    <td className="hidden max-w-56 px-3 py-3 sm:table-cell">
                      <p className="truncate font-medium text-slate-700">{r.customerName ?? "Misafir"}</p>
                      <p className="truncate text-xs text-slate-500">{r.customerEmail}</p>
                    </td>
                    <td className="px-4 py-3 sm:px-3">
                      <AdminBadge tone={status.tone}>{status.label}</AdminBadge>
                      <p className="mt-1 text-xs text-slate-500">Ödeme: {pay.label}</p>
                    </td>
                    <td className="hidden px-5 py-3 text-right font-semibold tabular-nums text-slate-900 sm:table-cell">{formatMinor(r.totalMinor)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminCard>
  );
}

function TopProducts({ rows }: { rows: Dashboard["topProducts"] }) {
  return (
    <AdminCard className="min-w-0">
      <AdminCardTitle title="En çok satanlar" subtitle="Dönemde tahsil edilen tutara göre" />
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">Bu dönemde satış yok.</p>
      ) : (
        <ol className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <li key={r.productId} className="flex items-center gap-3 px-5 py-3">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-700">{r.name}</span>
                <span className="text-xs text-slate-500">{formatCount(r.quantity)} adet</span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{formatTry(r.revenueMinor)}</span>
            </li>
          ))}
        </ol>
      )}
    </AdminCard>
  );
}

function LowStock({ rows }: { rows: NonNullable<Dashboard["lowStock"]> }) {
  return (
    <AdminCard className="min-w-0">
      <AdminCardTitle title="Kritik stok" subtitle="Satılabilir adedi 3 ve altı" />
      {rows.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500"><CheckCircle2 className="size-4 text-emerald-600" aria-hidden />Kritik stokta ürün yok.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.sku}>
              <Link href={`/admin/urunler/${r.productId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-700">{r.name}</span>
                  <span className="text-xs text-slate-500">{r.sku}</span>
                </span>
                <AdminBadge tone={r.available <= 0 ? "red" : "amber"}>{r.available <= 0 ? "Tükendi" : `${r.available} adet`}</AdminBadge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AdminCard>
  );
}
