/** Pure constants (no imports) — safe for "use client" panel code. */
export const SMTP_SECURITY = ["ssl", "starttls"] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY)[number];

/** Common providers for the panel's "hazır ayar" buttons (host / port / security only). */
export const SMTP_PRESETS = [
  { key: "gmail", label: "Gmail", host: "smtp.gmail.com", port: 465, security: "ssl", note: "Google hesabında 2 adımlı doğrulama açıkken oluşturulan 16 haneli uygulama şifresini girin." },
  { key: "outlook", label: "Outlook / Microsoft 365", host: "smtp.office365.com", port: 587, security: "starttls", note: "Microsoft 365 yöneticinizin SMTP AUTH'u açmış olması gerekir." },
  { key: "yandex", label: "Yandex", host: "smtp.yandex.com", port: 465, security: "ssl", note: "Yandex'te uygulama şifresi kullanın." },
] as const satisfies readonly { key: string; label: string; host: string; port: number; security: SmtpSecurity; note: string }[];
