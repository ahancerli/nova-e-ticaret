import { formatMinor } from "@/lib/money";
import { emailLayout, escapeHtml } from "@/modules/mail/domain/mail";

/**
 * Customer order e-mails (pure): which mail an outbox event sends and its text. The first mail of an order
 * (`placed`) carries the accepted distance-sales contract and pre-information form in full — the consumer must
 * receive them on a durable medium (Mesafeli Sözleşmeler Yönetmeliği). Card orders get that mail when the payment
 * is confirmed (`order.paid`), bank-transfer orders right away and a payment confirmation later.
 */
export type CustomerMailKind = "placed" | "paid" | "shipped" | "tracking" | "delivered" | "cancelled" | "refunded" | "return_requested" | "return_approved" | "return_rejected" | "invoice";

/** Events that only send an e-mail (return requests, invoice) — no SMS template exists for them. */
export const MAIL_ONLY_EVENTS = ["return.requested", "return.approved", "return.rejected", "invoice.issued"] as const;

export function customerMailFor(eventType: string, paymentMethod: string | null): CustomerMailKind | null {
  const transfer = paymentMethod === "bank_transfer";
  switch (eventType) {
    case "order.placed": return transfer ? "placed" : null;
    case "order.paid": return transfer ? "paid" : "placed";
    case "order.shipped": return "shipped";
    case "shipment.tracking_assigned": return "tracking";
    case "order.delivered": return "delivered";
    case "order.cancelled": return "cancelled";
    case "refund.succeeded": return "refunded";
    case "return.requested": return "return_requested";
    case "return.approved": return "return_approved";
    case "return.rejected": return "return_rejected";
    case "invoice.issued": return "invoice";
    default: return null;
  }
}

export interface OrderMailFacts {
  orderNumber: string;
  email: string;
  recipientName: string | null;
  isMember: boolean;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  totalMinor: number;
  items: { name: string; options: string; quantity: number; totalMinor: number }[];
  shippingAddress: string | null;
  paymentMethod: string | null;
  transfer: { bankName: string; accountHolder: string; iban: string; reference: string; expiresAt: string } | null;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}

export interface MailContext {
  brand: string;
  siteUrl: string;
  accent: string;
  contracts: { title: string; html: string }[];
  refundMinor: number | null;
  cancelReason: string | null;
  /** Return events: request number and the staff's reason (rejection) or note (approval). */
  returnNumber?: string | null;
  returnNote?: string | null;
  invoiceNumber?: string | null;
}

const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
const iban = (v: string) => v.replace(/(.{4})/g, "$1 ").trim();

const SUBJECT: Record<CustomerMailKind, string> = {
  placed: "Siparişiniz alındı",
  paid: "Ödemeniz onaylandı",
  shipped: "Siparişiniz kargoya verildi",
  tracking: "Kargo takip numaranız",
  delivered: "Siparişiniz teslim edildi",
  cancelled: "Siparişiniz iptal edildi",
  refunded: "İadeniz yapıldı",
  return_requested: "İade talebiniz alındı",
  return_approved: "İade talebiniz onaylandı",
  return_rejected: "İade talebiniz sonuçlandı",
  invoice: "Faturanız hazır",
};

function lead(kind: CustomerMailKind, f: OrderMailFacts, c: MailContext): string {
  switch (kind) {
    case "placed": return f.transfer
      ? `${f.orderNumber} numaralı siparişinizi aldık. Ödemenizi aşağıdaki hesaba gönderdiğinizde siparişinizi hazırlamaya başlayacağız.`
      : `${f.orderNumber} numaralı siparişinizi aldık ve ödemeniz onaylandı. Siparişinizi hazırlamaya başlıyoruz.`;
    case "paid": return `${f.orderNumber} numaralı siparişinizin ödemesi onaylandı. Siparişinizi hazırlamaya başlıyoruz.`;
    case "shipped": return `${f.orderNumber} numaralı siparişiniz kargoya verildi.`;
    case "tracking": return `${f.orderNumber} numaralı siparişinizin kargo takip numarası oluştu.`;
    case "delivered": return `${f.orderNumber} numaralı siparişiniz teslim edildi. Bizi tercih ettiğiniz için teşekkür ederiz.`;
    case "cancelled": return `${f.orderNumber} numaralı siparişiniz iptal edildi.${c.cancelReason ? ` Neden: ${c.cancelReason}` : ""}`;
    case "refunded": return `${f.orderNumber} numaralı siparişiniz için ${formatMinor(c.refundMinor ?? 0)} iade edildi. Tutarın hesabınıza yansıması bankanıza göre birkaç iş günü sürebilir.`;
    case "return_requested": return `${c.returnNumber ?? f.orderNumber} numaralı iade talebinizi aldık. İnceleyip en kısa sürede size döneceğiz; onaylanmadan ürünü kargoya vermeyin.`;
    case "return_approved": return `${c.returnNumber ?? f.orderNumber} numaralı iade talebiniz onaylandı. Ürünü, faturasıyla birlikte orijinal ambalajında kargoya verin; ürün bize ulaşınca ödemeniz iade edilecek.${c.returnNote ? ` Not: ${c.returnNote}` : ""}`;
    case "return_rejected": return `${c.returnNumber ?? f.orderNumber} numaralı iade talebiniz onaylanmadı.${c.returnNote ? ` Neden: ${c.returnNote}` : ""} Sorunuz varsa bu e-postayı yanıtlayabilirsiniz.`;
    case "invoice": return `${f.orderNumber} numaralı siparişinizin e-Arşiv faturası (${c.invoiceNumber ?? ""}) kesildi. Faturanızı sipariş sayfanızdan PDF olarak indirebilirsiniz.`;
  }
}

/** Link to the order: the account page for members, the guest order lookup otherwise. */
const orderLink = (f: OrderMailFacts, siteUrl: string) =>
  f.isMember ? `${siteUrl}/hesabim/siparis/${encodeURIComponent(f.orderNumber)}` : `${siteUrl}/siparis-sorgula`;

export function buildCustomerMail(kind: CustomerMailKind, f: OrderMailFacts, c: MailContext): { subject: string; text: string; html: string } {
  const subject = `${SUBJECT[kind]} · ${f.orderNumber}`;
  const hello = f.recipientName ? `Merhaba ${f.recipientName},` : "Merhaba,";
  const intro = lead(kind, f, c);
  const link = orderLink(f, c.siteUrl);
  const withItems = kind === "placed" || kind === "paid" || kind === "cancelled";
  const withTracking = (kind === "shipped" || kind === "tracking") && (f.trackingNumber || f.carrierName);

  const text: string[] = [hello, intro];
  const h: string[] = [`<p style="margin:0 0 6px">${escapeHtml(hello)}</p>`, `<p style="margin:0 0 20px">${escapeHtml(intro)}</p>`];

  if (withTracking) {
    const line = [f.carrierName, f.trackingNumber && `Takip no: ${f.trackingNumber}`].filter(Boolean).join(" · ");
    text.push(line, f.trackingUrl ? `Kargonu takip et: ${f.trackingUrl}` : "");
    h.push(`<p style="margin:0 0 8px;padding:14px 16px;background:#f4f4f8;border-radius:12px;font-weight:bold">${escapeHtml(line)}</p>`);
    if (f.trackingUrl) h.push(button(f.trackingUrl, "Kargonu takip et", c.accent));
  }

  if (kind === "placed" && f.transfer) {
    const t = f.transfer;
    text.push(`Havale / EFT bilgileri\n${t.bankName} · ${t.accountHolder}\nIBAN: ${iban(t.iban)}\nAçıklama: ${t.reference}\nSon ödeme: ${day.format(new Date(t.expiresAt))}`);
    h.push(`<table role="presentation" width="100%" style="margin:0 0 20px;border:2px solid ${c.accent};border-radius:12px;padding:6px 10px;font-size:14px">
<tr><td style="padding:6px;font-weight:bold" colspan="2">Havale / EFT bilgileri</td></tr>
${row("Banka", `${t.bankName} · ${t.accountHolder}`)}${row("IBAN", iban(t.iban))}${row("Açıklama", `${t.reference} (açıklamaya mutlaka yazın)`)}${row("Son ödeme", day.format(new Date(t.expiresAt)))}</table>`);
  }

  if (withItems && f.items.length) {
    text.push(f.items.map((i) => `${i.quantity} × ${i.name}${i.options ? ` (${i.options})` : ""} — ${formatMinor(i.totalMinor)}`).join("\n"));
    text.push(`Ara toplam: ${formatMinor(f.subtotalMinor)}${f.discountMinor ? `\nİndirim: −${formatMinor(f.discountMinor)}` : ""}\nKargo: ${f.shippingMinor ? formatMinor(f.shippingMinor) : "Ücretsiz"}\nToplam: ${formatMinor(f.totalMinor)}`);
    h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;font-size:14px;border-collapse:collapse">
${f.items.map((i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #ececf2">${i.quantity} × ${escapeHtml(i.name)}${i.options ? `<br><span style="color:#8a8d93">${escapeHtml(i.options)}</span>` : ""}</td><td align="right" style="padding:10px 0;border-bottom:1px solid #ececf2;white-space:nowrap">${formatMinor(i.totalMinor)}</td></tr>`).join("")}
${total("Ara toplam", formatMinor(f.subtotalMinor))}${f.discountMinor ? total("İndirim", `−${formatMinor(f.discountMinor)}`) : ""}${total("Kargo", f.shippingMinor ? formatMinor(f.shippingMinor) : "Ücretsiz")}
<tr><td style="padding:10px 0;font-weight:bold;font-size:16px">Toplam</td><td align="right" style="padding:10px 0;font-weight:bold;font-size:16px">${formatMinor(f.totalMinor)}</td></tr></table>`);
    if (f.shippingAddress && kind !== "cancelled") {
      text.push(`Teslimat adresi: ${f.shippingAddress}`);
      h.push(`<p style="margin:0 0 20px;font-size:14px;color:#5d596c"><b>Teslimat adresi:</b> ${escapeHtml(f.shippingAddress)}</p>`);
    }
  }

  text.push(`Siparişini görüntüle: ${link}`);
  h.push(button(link, f.isMember ? "Siparişimi görüntüle" : "Siparişimi sorgula", c.accent));

  if (kind === "placed" && c.contracts.length) {
    text.push("Onayladığınız sözleşmeler aşağıdadır; bu e-postayı saklayabilirsiniz.");
    h.push(`<p style="margin:28px 0 8px;font-size:13px;color:#5d596c">Sipariş sırasında onayladığınız metinler aşağıdadır. Bu e-postayı saklayabilirsiniz.</p>`);
    for (const k of c.contracts) {
      text.push(`--- ${k.title} ---\n${htmlToText(k.html)}`);
      h.push(`<div style="margin:12px 0 0;padding:16px;border:1px solid #ececf2;border-radius:12px;font-size:12px;line-height:1.55;color:#5d596c"><p style="margin:0 0 8px;font-size:14px;font-weight:bold;color:#2f2b3d">${escapeHtml(k.title)}</p>${k.html}</div>`);
    }
  }

  return { subject, text: text.filter(Boolean).join("\n\n"), html: emailLayout(c.brand, h.join("\n"), c.accent) };
}

const row = (k: string, v: string) => `<tr><td style="padding:6px;color:#8a8d93;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:6px;font-weight:bold">${escapeHtml(v)}</td></tr>`;
const total = (k: string, v: string) => `<tr><td style="padding:6px 0;color:#5d596c">${escapeHtml(k)}</td><td align="right" style="padding:6px 0">${escapeHtml(v)}</td></tr>`;
const button = (href: string, label: string, accent: string) =>
  `<p style="margin:0 0 8px"><a href="${escapeHtml(href)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">${escapeHtml(label)}</a></p>`;

/** Sanitized contract HTML → readable plain text for the text/plain part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|h[1-6]|li|tr|div)>/gi, "\n").replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
