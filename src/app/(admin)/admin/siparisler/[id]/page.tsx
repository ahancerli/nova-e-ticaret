import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMinor } from "@/lib/money";
import { requirePermission } from "@/server/auth";
import { getOrderDetail } from "@/server/services/admin-orders";
import { AdminBadge, AdminCard, AdminCardTitle, AdminPageHeader, AdminTable } from "@/components/admin/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sipariş detayı" };

const STATUS: Record<string, { label: string; tone: "amber" | "blue" | "green" | "red" | "slate" }> = {
  pending_payment: { label: "Ödeme bekleniyor", tone: "amber" },
  awaiting_transfer: { label: "Havale bekleniyor", tone: "amber" },
  paid: { label: "Ödendi", tone: "blue" },
  preparing: { label: "Hazırlanıyor", tone: "blue" },
  shipped: { label: "Kargoya verildi", tone: "green" },
  delivered: { label: "Teslim edildi", tone: "green" },
  completed: { label: "Tamamlandı", tone: "green" },
  cancelled: { label: "İptal edildi", tone: "red" },
  refunded: { label: "İade edildi", tone: "slate" },
  partially_refunded: { label: "Kısmi iade", tone: "slate" },
};

const SHIPMENT_STATUS: Record<string, { label: string; tone: "amber" | "blue" | "green" | "red" | "slate" }> = {
  preparing: { label: "Hazırlanıyor", tone: "blue" },
  shipped: { label: "Kargoya verildi", tone: "green" },
  in_transit: { label: "Yolda", tone: "amber" },
  delivered: { label: "Teslim edildi", tone: "green" },
  returned: { label: "İade döndü", tone: "red" },
  lost: { label: "Kayıp", tone: "red" },
  cancelled: { label: "İptal", tone: "slate" },
};

const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
const fmtDate = (v: string | null) => (v ? dt.format(new Date(v)) : "—");

function AddressCard({
  title,
  a,
}: {
  title: string;
  a: {
    recipient_name: string;
    phone_e164: string;
    country_code: string;
    province: string;
    district: string;
    line1: string;
    line2: string | null;
    postal_code: string | null;
    company_name: string | null;
    tax_office: string | null;
  } | null;
}) {
  return (
    <AdminCard className="p-5">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {!a ? (
        <p className="mt-2 text-sm text-slate-500">Adres bulunamadı.</p>
      ) : (
        <div className="mt-2 space-y-1 text-sm text-slate-600">
          <p className="font-medium text-slate-800">{a.recipient_name}</p>
          <p>{a.phone_e164}</p>
          <p>{a.line1}</p>
          {a.line2 ? <p>{a.line2}</p> : null}
          <p>{a.district} / {a.province}</p>
          <p>{a.country_code}{a.postal_code ? ` · ${a.postal_code}` : ""}</p>
          {a.company_name ? <p>Şirket: {a.company_name}</p> : null}
          {a.tax_office ? <p>Vergi dairesi: {a.tax_office}</p> : null}
        </div>
      )}
    </AdminCard>
  );
}

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("orders.read");
  const { id } = await params;
  const detail = await getOrderDetail(id, { canSeeCustomer: user.permissions.has("customers.read") });
  if (!detail) notFound();

  const status = STATUS[detail.status] ?? { label: detail.status, tone: "slate" as const };
  const payment = STATUS[detail.paymentStatus] ?? { label: detail.paymentStatus, tone: "slate" as const };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={`Sipariş #${detail.orderNumber}`}
        subtitle={`Sipariş tarihi: ${fmtDate(detail.placedAt)}`}
        actions={
          <>
            <Link href="/admin/siparisler" className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Listeye dön</Link>
            <button type="button" className="inline-flex min-h-9 items-center rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700">Durum güncelle</button>
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        <AdminBadge tone={status.tone}>{status.label}</AdminBadge>
        <AdminBadge tone={payment.tone}>Ödeme: {payment.label}</AdminBadge>
        {detail.provider ? <AdminBadge tone="purple">Sağlayıcı: {detail.provider}</AdminBadge> : null}
        {detail.shipmentStatus ? (
          <AdminBadge tone={(SHIPMENT_STATUS[detail.shipmentStatus] ?? { tone: "slate" as const }).tone}>
            Kargo: {(SHIPMENT_STATUS[detail.shipmentStatus] ?? { label: detail.shipmentStatus }).label}
          </AdminBadge>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <div className="space-y-4">
          <AdminCard>
            <AdminCardTitle title="Sipariş kalemleri" subtitle={`${detail.items.length} ürün satırı`} />
            <AdminTable>
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">Ürün</th>
                  <th className="px-3 py-3 font-medium">SKU</th>
                  <th className="px-3 py-3 text-right font-medium">Adet</th>
                  <th className="px-3 py-3 text-right font-medium">Birim</th>
                  <th className="px-3 py-3 text-right font-medium">İndirim</th>
                  <th className="px-3 py-3 text-right font-medium">Vergi</th>
                  <th className="px-4 py-3 text-right font-medium">Toplam</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((i) => (
                  <tr key={i.id} className="border-b border-slate-100">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{i.productName}</p>
                      {i.variant ? <p className="text-xs text-slate-500">{i.variant}</p> : null}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-600">{i.sku}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{i.quantity}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMinor(i.unitPriceMinor)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMinor(i.discountMinor)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatMinor(i.taxMinor)}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">{formatMinor(i.totalMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </AdminTable>
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Durum geçmişi" subtitle="Sipariş event akışı" />
            <div className="space-y-3 px-5 py-4">
              {detail.events.length === 0 ? (
                <p className="text-sm text-slate-500">Henüz event kaydı yok.</p>
              ) : (
                detail.events.map((e, idx) => (
                  <div key={`${e.created_at}-${idx}`} className="rounded-lg border border-slate-200 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">{e.event_type}</p>
                      <span className="text-xs text-slate-500">{fmtDate(e.created_at)}</span>
                    </div>
                    {(e.from_status || e.to_status) ? (
                      <p className="mt-1 text-xs text-slate-500">{e.from_status ?? "—"} → {e.to_status ?? "—"}</p>
                    ) : null}
                    {e.note ? <p className="mt-1 text-xs text-slate-500">{e.note}</p> : null}
                  </div>
                ))
              )}
            </div>
          </AdminCard>
        </div>

        <div className="space-y-4">
          <AdminCard className="p-5">
            <h3 className="text-sm font-semibold text-slate-900">Müşteri</h3>
            <div className="mt-2 space-y-1 text-sm text-slate-600">
              <p>{detail.customerEmail}</p>
              <p>{detail.customerPhone ?? "—"}</p>
            </div>
            {detail.customerNote ? <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">Not: {detail.customerNote}</p> : null}
          </AdminCard>

          <AdminCard className="p-5">
            <h3 className="text-sm font-semibold text-slate-900">Ödeme özeti</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between"><dt className="text-slate-500">Ara toplam</dt><dd className="font-medium">{formatMinor(detail.money.subtotalMinor)}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-slate-500">İndirim</dt><dd className="font-medium">-{formatMinor(detail.money.discountMinor)}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-slate-500">Kargo</dt><dd className="font-medium">{formatMinor(detail.money.shippingMinor)}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-slate-500">Vergi</dt><dd className="font-medium">{formatMinor(detail.money.taxMinor)}</dd></div>
              <div className="mt-2 border-t border-slate-200 pt-2 flex items-center justify-between"><dt className="font-semibold text-slate-800">Toplam</dt><dd className="text-base font-semibold">{formatMinor(detail.money.totalMinor)}</dd></div>
            </dl>
          </AdminCard>

          <AddressCard title="Teslimat adresi" a={detail.shippingAddress} />
          <AddressCard title="Fatura adresi" a={detail.billingAddress} />

          <AdminCard>
            <AdminCardTitle title="Ödeme hareketleri" subtitle={`${detail.payments.length} kayıt`} />
            <div className="space-y-2 px-4 py-4">
              {detail.payments.length === 0 ? <p className="text-sm text-slate-500">Ödeme kaydı yok.</p> : detail.payments.map((p, idx) => (
                <div key={`${p.created_at}-${idx}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">{p.provider}</span>
                    <AdminBadge tone={(STATUS[p.status] ?? { tone: "slate" as const }).tone}>{p.status}</AdminBadge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{fmtDate(p.created_at)} · {formatMinor(p.amount_minor)}</p>
                  {p.failure_code ? <p className="mt-1 text-xs text-red-600">Hata: {p.failure_code}</p> : null}
                </div>
              ))}
            </div>
          </AdminCard>

          <AdminCard>
            <AdminCardTitle title="Kargo gönderileri" subtitle={`${detail.shipments.length} kayıt`} />
            <div className="space-y-2 px-4 py-4">
              {detail.shipments.length === 0 ? <p className="text-sm text-slate-500">Kargo kaydı yok.</p> : detail.shipments.map((s) => (
                <div key={s.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">{s.shipping_method_name}</span>
                    <AdminBadge tone={(SHIPMENT_STATUS[s.status] ?? { tone: "slate" as const }).tone}>
                      {(SHIPMENT_STATUS[s.status] ?? { label: s.status }).label}
                    </AdminBadge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Ürün satırı: {s.item_count} · {fmtDate(s.created_at)}</p>
                  {s.tracking_number ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Takip: {s.tracking_url ? <a href={s.tracking_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{s.tracking_number}</a> : s.tracking_number}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </AdminCard>
        </div>
      </div>
    </div>
  );
}

