import { formatMinor } from "@/lib/money";
import { emailLayout, escapeHtml } from "@/modules/mail/domain/mail";
import type { DueAlert } from "./alert";

export interface AlertMailContext {
  brand: string;
  siteUrl: string;
  accent: string;
}

const absolute = (url: string, siteUrl: string) => (/^https?:\/\//i.test(url) ? url : `${siteUrl}${url.startsWith("/") ? "" : "/"}${url}`);

/** "Yeniden stokta" / "Fiyatı düştü" e-mail (pure). One mail per alert; the alert is done after it. */
export function buildAlertMail(a: DueAlert, c: AlertMailContext): { subject: string; text: string; html: string } {
  const productUrl = `${c.siteUrl}/urun/${encodeURIComponent(a.productSlug)}`;
  const accountUrl = `${c.siteUrl}/hesabim?sekme=haber-ver`;
  const drop = a.kind === "price_drop";
  const subject = drop ? `Fiyatı düştü: ${a.productName}` : `Yeniden stokta: ${a.productName}`;
  const hello = `Merhaba ${a.customerName},`;
  const lead = drop
    ? "Takip ettiğiniz ürünün fiyatı düştü. Stoklar sınırlı olabilir, fırsatı kaçırmayın."
    : "Haber vermemizi istediğiniz ürün yeniden stokta. Stoklar sınırlı olabilir, tükenmeden göz atın.";
  const name = a.variantLabel ? `${a.productName} (${a.variantLabel})` : a.productName;
  const price = drop && a.baselinePriceMinor != null ? `${formatMinor(a.baselinePriceMinor)} → ${formatMinor(a.priceMinor)}` : formatMinor(a.priceMinor);
  const footer = "Bu e-postayı, ürün sayfasında verdiğiniz haber ver talebi üzerine bir kez gönderdik.";

  const text = [hello, lead, `${name}\n${price}`, `Ürüne git: ${productUrl}`, `${footer}\nHaber ver listeniz: ${accountUrl}`].join("\n\n");
  const image = a.imageUrl
    ? `<td width="96" style="padding-right:16px;vertical-align:top"><img src="${escapeHtml(absolute(a.imageUrl, c.siteUrl))}" alt="" width="96" height="96" style="display:block;width:96px;height:96px;object-fit:contain;border-radius:12px;background:#f4f4f8"></td>`
    : "";
  const priceHtml = drop && a.baselinePriceMinor != null
    ? `<span style="color:#8a8d93;text-decoration:line-through">${formatMinor(a.baselinePriceMinor)}</span> <b style="font-size:18px;color:${c.accent}">${formatMinor(a.priceMinor)}</b>`
    : `<b style="font-size:18px">${formatMinor(a.priceMinor)}</b>`;
  const html = emailLayout(c.brand, `<p style="margin:0 0 6px">${escapeHtml(hello)}</p>
<p style="margin:0 0 20px">${escapeHtml(lead)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;padding:14px;border:1px solid #ececf2;border-radius:12px"><tr>${image}
<td style="vertical-align:top"><p style="margin:0 0 4px;font-weight:bold">${escapeHtml(a.productName)}</p>${a.variantLabel ? `<p style="margin:0 0 8px;font-size:13px;color:#8a8d93">${escapeHtml(a.variantLabel)}</p>` : ""}<p style="margin:0">${priceHtml}</p></td></tr></table>
<p style="margin:0 0 8px"><a href="${escapeHtml(productUrl)}" style="display:inline-block;background:${c.accent};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Ürüne git</a></p>
<p style="margin:24px 0 0;font-size:13px;color:#6b7280">${escapeHtml(footer)} <a href="${escapeHtml(accountUrl)}">Haber ver listem</a></p>`, c.accent);
  return { subject, text, html };
}
