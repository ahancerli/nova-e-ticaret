import Link from "next/link";
import type { ReactNode } from "react";
import { formatMinor } from "@/lib/money";
import { AdminBadge, AdminCard, AdminTable } from "@/components/admin/ui";
import { BadgeCheck, CircleAlert, Clock3, CreditCard, ReceiptText, WalletCards } from "lucide-react";
import { GetDashboardToken } from "@/modules/orders";
import { requireAdminPage, resolveService } from "@/server/app";

export const metadata = { title: "Gösterge paneli" };

const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });

export default async function AdminDashboard() {
  const user = await requireAdminPage("orders.read");
  const { last30Days: s, recent, lowStock } = await (await resolveService(GetDashboardToken)).execute(user.permissions.has("customers.read"));
  const completed = Math.max(0, s.orders - s.waiting);

  return (
    <div className="space-y-4">
      <AdminCard className="p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <DashboardStat label="Ödeme bekleyen" value={s.waiting} icon={<Clock3 className="h-4 w-4" />} />
          <DashboardStat label="Ödemesi alınan / işlenen" value={completed} icon={<BadgeCheck className="h-4 w-4" />} />
          <DashboardStat label="İade (tam / kısmi)" value={s.refunded} icon={<ReceiptText className="h-4 w-4" />} />
          <DashboardStat label="Başarısız ödeme" value={s.failed} icon={<WalletCards className="h-4 w-4" />} />
        </div>
      </AdminCard>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <AdminCard>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-800">Son siparişler</h2>
              <p className="text-sm text-slate-500">En yeni 8 sipariş</p>
            </div>
            <Link href="/admin/siparisler" className="inline-flex h-9 items-center rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50">
              Tümünü gör
            </Link>
          </div>
          <AdminTable>
            <thead>
              <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Sipariş</th>
                <th className="px-3 py-3">Tarih</th>
                <th className="px-3 py-3">Müşteri</th>
                <th className="px-3 py-3">Ödeme</th>
                <th className="px-4 py-3 text-right">Tutar</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="px-4 py-3">
                    <Link href={`/admin/siparisler/${r.id}`} className="font-semibold text-[#7367f0] hover:underline">#{r.orderNumber}</Link>
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-600">{dateFmt.format(new Date(r.placedAt))}</td>
                  <td className="px-3 py-3">
                    <p className="text-sm font-medium text-slate-700">{r.customerName ?? "Misafir"}</p>
                    <p className="text-xs text-slate-500">{r.customerEmail}</p>
                  </td>
                  <td className="px-3 py-3">
                    <PaymentBadge status={r.paymentStatus} />
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{formatMinor(r.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        </AdminCard>

        <div className="space-y-4">
          <AdminCard className="p-5">
            <h3 className="text-sm font-semibold text-slate-800">Ciro</h3>
            <p className="mt-2 text-3xl font-semibold text-slate-800">{formatMinor(s.revenueMinor)}</p>
            <p className="mt-1 text-sm text-slate-500">Son 30 gün tahsil edilen tutar</p>
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              <div className="flex items-center justify-between">
                <span>Toplam sipariş</span>
                <span className="font-medium">{s.orders.toLocaleString("tr-TR")}</span>
              </div>
            </div>
          </AdminCard>

          <AdminCard>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h3 className="text-sm font-semibold text-slate-800">Kritik stok</h3>
              <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                <CircleAlert className="h-3.5 w-3.5" />
                İlgilenilmeli
              </span>
            </div>
            <div className="space-y-2 px-4 py-4">
              {lowStock.length === 0 ? (
                <p className="text-sm text-slate-500">Kritik stokta ürün yok.</p>
              ) : (
                lowStock.map((r) => (
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
        <p className="text-3xl font-semibold leading-none text-slate-700">{value.toLocaleString("tr-TR")}</p>
        <p className="mt-1 text-sm text-slate-500">{label}</p>
      </div>
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">{icon}</span>
    </div>
  );
}

function PaymentBadge({ status }: { status: string }) {
  if (status === "paid") return <span className="inline-flex items-center gap-1.5 text-emerald-600"><span className="size-2 rounded-full bg-emerald-500" />Ödendi</span>;
  if (status === "failed") return <span className="inline-flex items-center gap-1.5 text-rose-500"><span className="size-2 rounded-full bg-rose-500" />Başarısız</span>;
  return <span className="inline-flex items-center gap-1.5 text-amber-600"><span className="size-2 rounded-full bg-amber-500" />Bekliyor</span>;
}
