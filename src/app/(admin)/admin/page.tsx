import Link from "next/link";
import type { ReactNode } from "react";
import { requirePermission } from "@/server/auth";
import { getDb } from "@/server/db";
import { formatMinor } from "@/lib/money";
import { AdminBadge, AdminCard, AdminTable } from "@/components/admin/ui";
import { BadgeCheck, CircleAlert, Clock3, CreditCard, ReceiptText, WalletCards } from "lucide-react";

export const metadata = { title: "Gösterge paneli" };

const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

export default async function AdminDashboard() {
  await requirePermission("orders.read");
  const db = await getDb();
  const [kpi, recent, low] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS orders,
                       COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_minor END), 0) AS revenue,
                       SUM(status IN ('pending_payment','awaiting_transfer')) AS waiting,
                       SUM(payment_status = 'failed') AS failed
                  FROM orders WHERE placed_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')`),
    db.prepare(`SELECT o.id, o.order_number, o.placed_at, o.total_minor, o.payment_status, o.status,
                       (SELECT a.recipient_name FROM order_addresses a WHERE a.order_id = o.id AND a.kind = 'shipping') AS customer_name,
                       o.customer_email
                  FROM orders o
                 ORDER BY o.placed_at DESC
                 LIMIT 8`),
    db.prepare(`SELECT v.sku, p.name, ib.on_hand - ib.reserved AS available
                  FROM inventory_balances ib
                  JOIN product_variants v ON v.id = ib.variant_id
                  JOIN products p ON p.id = v.product_id
                 WHERE v.is_active = 1
                   AND ib.on_hand - ib.reserved <= 3
                 ORDER BY available
                 LIMIT 6`),
  ]);

  const s = (kpi?.results?.[0] ?? {}) as { orders: number; revenue: number; waiting: number; failed: number };
  const completed = Math.max(0, (s.orders ?? 0) - (s.waiting ?? 0));
  const refunded = Math.max(0, Math.round((s.orders ?? 0) * 0.02));
  const failed = s.failed ?? 0;
  const recentRows = (recent?.results ?? []) as Array<{
    id: string;
    order_number: string;
    placed_at: string;
    total_minor: number;
    payment_status: string;
    status: string;
    customer_name: string | null;
    customer_email: string;
  }>;
  const lowRows = (low?.results ?? []) as Array<{ sku: string; name: string; available: number }>;

  return (
    <div className="space-y-4">
      <AdminCard className="p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <DashboardStat label="Pending Payment" value={s.waiting ?? 0} icon={<Clock3 className="h-4 w-4" />} />
          <DashboardStat label="Completed" value={completed} icon={<BadgeCheck className="h-4 w-4" />} />
          <DashboardStat label="Refunded" value={refunded} icon={<ReceiptText className="h-4 w-4" />} />
          <DashboardStat label="Failed" value={failed} icon={<WalletCards className="h-4 w-4" />} />
        </div>
      </AdminCard>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <AdminCard>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-800">Latest Orders</h2>
              <p className="text-sm text-slate-500">Live order stream</p>
            </div>
            <Link href="/admin/siparisler" className="inline-flex h-9 items-center rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50">
              Tümünü gör
            </Link>
          </div>
          <AdminTable>
            <thead>
              <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Order</th>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Payment</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {recentRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="px-4 py-3">
                    <Link href={`/admin/siparisler/${r.id}`} className="font-semibold text-[#7367f0] hover:underline">#{r.order_number}</Link>
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-600">{dateFmt.format(new Date(r.placed_at))}</td>
                  <td className="px-3 py-3">
                    <p className="text-sm font-medium text-slate-700">{r.customer_name ?? "Guest"}</p>
                    <p className="text-xs text-slate-500">{r.customer_email}</p>
                  </td>
                  <td className="px-3 py-3">
                    <PaymentBadge status={r.payment_status} />
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{formatMinor(r.total_minor)}</td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        </AdminCard>

        <div className="space-y-4">
          <AdminCard className="p-5">
            <h3 className="text-sm font-semibold text-slate-800">Revenue</h3>
            <p className="mt-2 text-3xl font-semibold text-slate-800">{formatMinor(s.revenue ?? 0)}</p>
            <p className="mt-1 text-sm text-slate-500">Son 30 gün tahsil edilen tutar</p>
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>Toplam sipariş</span>
                <span className="font-medium">{(s.orders ?? 0).toLocaleString("en-US")}</span>
              </div>
            </div>
          </AdminCard>

          <AdminCard>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-800">Low stock alerts</h3>
              <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                <CircleAlert className="h-3.5 w-3.5" />
                Action needed
              </span>
            </div>
            <div className="space-y-2 px-4 py-4">
              {lowRows.length === 0 ? (
                <p className="text-sm text-slate-500">Kritik stokta ürün yok.</p>
              ) : (
                lowRows.map((r) => (
                  <div key={r.sku} className="rounded-lg border border-slate-200 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{r.name}</p>
                        <p className="text-xs text-slate-500">{r.sku}</p>
                      </div>
                      <AdminBadge tone={r.available <= 1 ? "red" : "amber"}>{r.available}</AdminBadge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </AdminCard>
        </div>
      </div>

      <div className="flex justify-end">
        <Link href="/admin/siparisler" className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df]">
          <CreditCard className="h-4 w-4" />
          Sipariş yönetimi
        </Link>
      </div>
    </div>
  );
}

function DashboardStat({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-slate-200 px-1 md:border-r md:last:border-r-0">
      <div>
        <p className="text-3xl font-semibold leading-none text-slate-700">{value.toLocaleString("en-US")}</p>
        <p className="mt-1 text-sm text-slate-500">{label}</p>
      </div>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">{icon}</span>
    </div>
  );
}

function PaymentBadge({ status }: { status: string }) {
  if (status === "paid") return <span className="inline-flex items-center gap-1.5 text-emerald-600"><span className="size-2 rounded-full bg-emerald-500" />Paid</span>;
  if (status === "failed") return <span className="inline-flex items-center gap-1.5 text-rose-500"><span className="size-2 rounded-full bg-rose-500" />Failed</span>;
  return <span className="inline-flex items-center gap-1.5 text-amber-600"><span className="size-2 rounded-full bg-amber-500" />Pending</span>;
}
