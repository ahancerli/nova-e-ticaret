import { redirect } from "next/navigation";
import { currentAdminUser } from "@/server/auth";
import { queryAll } from "@/server/db";
import { getOrderDetail, type OrderDetail } from "@/server/services/admin-orders";
import { formatMinor, includedTaxMinor } from "@/lib/money";
import { orderStatusMeta, PROVIDER_LABEL } from "@/lib/order-rules";
import { PrintToolbar } from "@/components/admin/PrintToolbar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Belge yazdır", robots: { index: false, follow: false } };

type Doc = "fatura" | "irsaliye";
const dt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" });
const dtShort = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" });

/**
 * Printable order documents outside the admin shell (no sidebar / topbar in print).
 * /admin/yazdir?belge=fatura|irsaliye&ids=<orderId>,<orderId>…   (max 50 per print)
 */
export default async function PrintPage({ searchParams }: { searchParams: Promise<{ belge?: string; ids?: string }> }) {
  const user = await currentAdminUser();
  if (!user) redirect("/admin/giris?next=/admin/siparisler");
  if (!user.isStaff || !user.permissions.has("orders.read")) redirect("/admin");

  const sp = await searchParams;
  const doc: Doc = sp.belge === "irsaliye" ? "irsaliye" : "fatura";
  const ids = [...new Set((sp.ids ?? "").split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{1,64}$/.test(s)))].slice(0, 50);
  const canSeeCustomer = user.permissions.has("customers.read");

  const [orders, settings] = await Promise.all([
    Promise.all(ids.map((id) => getOrderDetail(id, { canSeeCustomer }))),
    queryAll<{ key: string; value_json: string }>("SELECT key, value_json FROM site_settings WHERE key IN ('site.name','contact.email','contact.phone')"),
  ]);
  const s = Object.fromEntries(settings.map((r) => [r.key, JSON.parse(r.value_json) as string]));
  const seller = { name: s["site.name"] ?? "nova.", email: s["contact.email"] ?? "", phone: s["contact.phone"] ?? "" };
  const found = orders.filter((o): o is OrderDetail => !!o);

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <PrintToolbar count={found.length} doc={doc} missing={ids.length - found.length} masked={!canSeeCustomer} />
      {found.length === 0 ? (
        <p className="mx-auto mt-16 max-w-md text-center text-sm text-slate-500">Yazdırılacak sipariş bulunamadı.</p>
      ) : (
        found.map((o) => (doc === "fatura" ? <InvoiceSheet key={o.id} o={o} seller={seller} /> : <WaybillSheet key={o.id} o={o} seller={seller} />))
      )}
    </div>
  );
}

type Seller = { name: string; email: string; phone: string };

function Sheet({ title, subtitle, o, seller, children }: { title: string; subtitle: string; o: OrderDetail; seller: Seller; children: React.ReactNode }) {
  return (
    <article className="print-sheet mx-auto mb-6 max-w-[210mm] bg-white p-10 text-[13px] leading-relaxed text-slate-800 shadow-lg ring-1 ring-slate-200">
      <header className="flex items-start justify-between gap-6 border-b-2 border-slate-900 pb-5">
        <div>
          <p className="text-3xl font-black tracking-tight">{seller.name.replace(/\.$/, "")}<span className="text-[#7367f0]">.</span></p>
          <p className="mt-1 text-xs text-slate-500">{[seller.email, seller.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold uppercase tracking-wide">{title}</p>
          <p className="text-xs text-slate-500">{subtitle}</p>
          <p className="mt-2 font-mono text-base font-semibold">#{o.orderNumber}</p>
          <p className="text-xs text-slate-500">Sipariş tarihi: {dt.format(new Date(o.placedAt))}</p>
        </div>
      </header>
      {children}
      <footer className="mt-8 border-t border-slate-200 pt-3 text-[11px] text-slate-400">
        Bu belge bilgi amaçlıdır; e-Fatura / e-Arşiv / e-İrsaliye yerine geçmez. Yazdırılma: {dtShort.format(new Date())} · Sipariş kimliği {o.id}
      </footer>
    </article>
  );
}

function AddressBlock({ title, a, email }: { title: string; a: OrderDetail["shippingAddress"]; email?: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      {a ? (
        <div className="mt-1">
          <p className="font-semibold">{a.recipientName}</p>
          {a.companyName ? <p>{a.companyName}{a.taxOffice ? ` · VD: ${a.taxOffice}` : ""}</p> : null}
          <p>{a.line1}{a.line2 ? `, ${a.line2}` : ""}</p>
          <p>{a.district} / {a.province}{a.postalCode ? ` ${a.postalCode}` : ""} · {a.countryCode}</p>
          {a.phone ? <p className="text-slate-500">{a.phone}</p> : null}
          {email ? <p className="text-slate-500">{email}</p> : null}
        </div>
      ) : <p className="mt-1 text-slate-400">—</p>}
    </div>
  );
}

function InvoiceSheet({ o, seller }: { o: OrderDetail; seller: Seller }) {
  // VAT is included in prices: break it down per rate (items + shipping at 20 %, same assumption as checkout).
  const vat = new Map<number, number>();
  for (const i of o.items) vat.set(i.taxRateBps, (vat.get(i.taxRateBps) ?? 0) + i.taxMinor);
  if (o.money.shippingMinor) vat.set(2000, (vat.get(2000) ?? 0) + includedTaxMinor(o.money.shippingMinor, 2000));
  const payment = o.payments[0];
  return (
    <Sheet title="Sipariş özeti" subtitle="Proforma fatura" o={o} seller={seller}>
      <section className="grid grid-cols-2 gap-8 py-6">
        <AddressBlock title="Fatura adresi" a={o.billingAddress ?? o.shippingAddress} email={o.customer.email} />
        <AddressBlock title="Teslimat adresi" a={o.shippingAddress} />
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-slate-300 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-2 py-2">#</th><th className="px-2 py-2">Ürün</th><th className="px-2 py-2 text-right">Adet</th>
            <th className="px-2 py-2 text-right">Birim</th><th className="px-2 py-2 text-right">KDV</th><th className="px-2 py-2 text-right">İndirim</th><th className="px-2 py-2 text-right">Tutar</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((i, idx) => (
            <tr key={i.id} className="border-b border-slate-200 align-top">
              <td className="px-2 py-2 text-slate-400">{idx + 1}</td>
              <td className="px-2 py-2"><p className="font-medium">{i.productName}</p><p className="text-[11px] text-slate-500">{i.variant ? `${i.variant} · ` : ""}{i.sku}</p></td>
              <td className="px-2 py-2 text-right tabular-nums">{i.quantity}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatMinor(i.unitPriceMinor)}</td>
              <td className="px-2 py-2 text-right tabular-nums">%{i.taxRateBps / 100}</td>
              <td className="px-2 py-2 text-right tabular-nums">{i.discountMinor ? `−${formatMinor(i.discountMinor)}` : "—"}</td>
              <td className="px-2 py-2 text-right font-medium tabular-nums">{formatMinor(i.totalMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="mt-5 flex justify-between gap-8">
        <div className="text-xs text-slate-500">
          <p><b className="text-slate-700">Ödeme:</b> {payment ? `${PROVIDER_LABEL[payment.provider] ?? payment.provider}` : "—"} · {orderStatusMeta(o.status).label}</p>
          {payment?.bankTransfer ? <p>Havale referansı: <span className="font-mono">{payment.bankTransfer.referenceCode}</span></p> : null}
          {o.adjustments.length ? <p className="mt-1">Uygulanan indirimler: {o.adjustments.map((a) => `${a.label}${a.couponCode ? ` (${a.couponCode})` : ""}`).join(", ")}</p> : null}
          {o.money.refundedMinor ? <p className="mt-1 text-red-600">İade edilen: {formatMinor(o.money.refundedMinor)}</p> : null}
        </div>
        <dl className="w-72 flex-none space-y-1">
          <div className="flex justify-between"><dt className="text-slate-500">Ara toplam</dt><dd className="tabular-nums">{formatMinor(o.money.subtotalMinor)}</dd></div>
          {o.money.discountMinor ? <div className="flex justify-between"><dt className="text-slate-500">İndirim</dt><dd className="tabular-nums">−{formatMinor(o.money.discountMinor)}</dd></div> : null}
          <div className="flex justify-between"><dt className="text-slate-500">Kargo</dt><dd className="tabular-nums">{o.money.shippingMinor ? formatMinor(o.money.shippingMinor) : "Ücretsiz"}</dd></div>
          {[...vat].filter(([, v]) => v > 0).sort(([a], [b]) => a - b).map(([rate, v]) => (
            <div key={rate} className="flex justify-between text-xs text-slate-500"><dt>Dahil KDV %{rate / 100}</dt><dd className="tabular-nums">{formatMinor(v)}</dd></div>
          ))}
          <div className="mt-2 flex justify-between border-t-2 border-slate-900 pt-2 text-base font-bold"><dt>Genel toplam</dt><dd className="tabular-nums">{formatMinor(o.money.totalMinor)}</dd></div>
        </dl>
      </section>
    </Sheet>
  );
}

function WaybillSheet({ o, seller }: { o: OrderDetail; seller: Seller }) {
  const shipment = o.shipments[0];
  return (
    <Sheet title="Sevk irsaliyesi" subtitle="Bilgi amaçlı sevk belgesi" o={o} seller={seller}>
      <section className="grid grid-cols-2 gap-8 py-6">
        <AddressBlock title="Teslim alacak" a={o.shippingAddress} />
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sevk bilgisi</p>
          <p><span className="text-slate-500">Kargo:</span> {shipment?.methodName ?? "—"}</p>
          <p><span className="text-slate-500">Takip no:</span> <span className="font-mono">{shipment?.trackingNumber ?? "—"}</span></p>
          <p><span className="text-slate-500">Sevk tarihi:</span> {shipment?.shippedAt ? dt.format(new Date(shipment.shippedAt)) : "—"}</p>
          <p><span className="text-slate-500">Koli sayısı:</span> {Math.max(1, o.shipments.length)}</p>
        </div>
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-slate-300 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-2 py-2">#</th><th className="px-2 py-2">Ürün</th><th className="px-2 py-2">SKU</th>
            <th className="px-2 py-2 text-right">Sipariş</th><th className="px-2 py-2 text-right">Sevk edilen</th><th className="px-2 py-2 text-center">Kontrol</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((i, idx) => (
            <tr key={i.id} className="border-b border-slate-200">
              <td className="px-2 py-2.5 text-slate-400">{idx + 1}</td>
              <td className="px-2 py-2.5"><p className="font-medium">{i.productName}</p>{i.variant ? <p className="text-[11px] text-slate-500">{i.variant}</p> : null}</td>
              <td className="px-2 py-2.5 font-mono text-xs">{i.sku}</td>
              <td className="px-2 py-2.5 text-right tabular-nums">{i.quantity}</td>
              <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{i.shippedQty || i.quantity}</td>
              <td className="px-2 py-2.5 text-center"><span className="inline-block size-4 rounded border border-slate-400" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {o.customerNote ? <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs"><b>Müşteri notu:</b> {o.customerNote}</p> : null}
      <section className="mt-12 grid grid-cols-2 gap-12 text-xs text-slate-500">
        {["Teslim eden (ad soyad / imza)", "Teslim alan (ad soyad / imza)"].map((l) => (
          <div key={l}><div className="h-16 border-b border-slate-400" /><p className="mt-1">{l}</p></div>
        ))}
      </section>
    </Sheet>
  );
}
