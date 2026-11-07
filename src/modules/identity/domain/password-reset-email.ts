import { emailLayout, escapeHtml, type MailMessage } from "@/modules/mail";

/** The "reset your password" e-mail (Turkish). The link is single use; the TTL is stated in hours. */
export function passwordResetEmail(p: { to: string; name: string; link: string; brand: string; ttlHours: number; panel: boolean }): MailMessage {
  const where = p.panel ? "yönetim paneli" : "mağaza";
  const first = p.name.split(" ")[0] || p.name;
  return {
    purpose: "password_reset",
    to: p.to,
    toName: p.name,
    subject: `${p.brand}: parola sıfırlama`,
    text: [
      `Merhaba ${first},`,
      "",
      `${p.brand} ${where} hesabınız için parola sıfırlama istendi. Yeni parolanızı belirlemek için bağlantıyı açın:`,
      p.link,
      "",
      `Bağlantı ${p.ttlHours} saat geçerlidir ve yalnız bir kez kullanılabilir.`,
      "Bu isteği siz yapmadıysanız bu e-postayı yok sayın; parolanız değişmez.",
    ].join("\n"),
    html: emailLayout(p.brand, `
      <p style="margin:0 0 12px">Merhaba ${escapeHtml(first)},</p>
      <p style="margin:0 0 20px">${escapeHtml(p.brand)} ${where} hesabınız için parola sıfırlama istendi. Yeni parolanızı belirlemek için aşağıdaki düğmeye tıklayın.</p>
      <p style="margin:0 0 24px"><a href="${escapeHtml(p.link)}" style="display:inline-block;background:#7367f0;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">Parolamı sıfırla</a></p>
      <p style="margin:0 0 8px;font-size:13px;color:#6d6b77">Bağlantı ${p.ttlHours} saat geçerlidir ve yalnız bir kez kullanılabilir. Düğme çalışmazsa bu adresi tarayıcınıza yapıştırın:</p>
      <p style="margin:0 0 20px;font-size:12px;word-break:break-all"><a href="${escapeHtml(p.link)}" style="color:#7367f0">${escapeHtml(p.link)}</a></p>
      <p style="margin:0;font-size:13px;color:#6d6b77">Bu isteği siz yapmadıysanız bu e-postayı yok sayın; parolanız değişmez.</p>`),
  };
}
