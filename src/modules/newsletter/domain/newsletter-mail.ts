import { emailLayout, escapeHtml } from "@/modules/mail/domain/mail";
import { CONFIRM_HOURS } from "./newsletter";

export interface NewsletterMailContext {
  brand: string;
  siteUrl: string;
  accent: string;
}

/** Double opt-in e-mail: one button; ignoring it keeps the address off the list. */
export function buildConfirmMail(token: string, c: NewsletterMailContext): { subject: string; text: string; html: string } {
  const url = `${c.siteUrl}/bulten/onay?t=${encodeURIComponent(token)}`;
  const subject = `${c.brand} e-bültenine kaydınızı onaylayın`;
  const lead = `${c.brand} e-bültenine kayıt olmak istediğinizi aldık. Kampanya ve yeniliklerden haberdar olmak için aşağıdaki düğmeyle onaylayın.`;
  const note = `Bağlantı ${CONFIRM_HOURS} saat geçerlidir. Bu kaydı siz yapmadıysanız bir şey yapmanıza gerek yok; onaylanmayan adreslere e-bülten göndermeyiz.`;
  const text = ["Merhaba,", lead, `Kaydımı onayla: ${url}`, note].join("\n\n");
  const html = emailLayout(c.brand, `<p style="margin:0 0 6px">Merhaba,</p>
<p style="margin:0 0 20px">${escapeHtml(lead)}</p>
<p style="margin:0 0 20px"><a href="${escapeHtml(url)}" style="display:inline-block;background:${c.accent};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Kaydımı onayla</a></p>
<p style="margin:0;font-size:13px;color:#6b7280">${escapeHtml(note)}</p>`, c.accent);
  return { subject, text, html };
}
