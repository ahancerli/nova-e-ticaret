import { toBase64 } from "@/core";

export { SMTP_PRESETS, SMTP_SECURITY, type SmtpSecurity } from "./presets";
import type { SmtpSecurity } from "./presets";

export interface MailSettingsInput {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  /** Empty = keep the stored password (required on first save). */
  password?: string;
  fromEmail: string;
  fromName: string;
  expectedUpdatedAt: string | null;
}

/** What the panel sees — never the password. */
export interface MailSettingsView {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  fromEmail: string;
  fromName: string;
  passwordSet: true;
  updatedAt: string;
  updatedBy: string | null;
}

/** What a delivery-list row is about (mail_deliveries.purpose). */
export type MailPurpose = "password_reset" | "test" | "other";
export type MailDeliveryStatus = "sent" | "failed" | "not_configured" | "throttled";

/** One row of "Son gönderimler" (panel). */
export interface MailDeliveryView {
  id: string;
  purpose: MailPurpose;
  recipient: string;
  status: MailDeliveryStatus;
  smtpHost: string | null;
  stage: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** SMTP server's own answer: the accept line (queue id) or the rejection. */
  serverReply: string | null;
  latencyMs: number | null;
  createdAt: string;
}

export interface MailMessage {
  /** For the delivery list; default "other". */
  purpose?: MailPurpose;
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html: string;
}

const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${toBase64(new TextEncoder().encode(s))}?=`);
const quoteName = (name: string) => (/^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, "")}"` : encodeWord(name));
const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n");
const noBreaks = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/**
 * RFC 5322 message with a plain-text and an HTML part (base64, UTF-8). Header values are stripped of line
 * breaks and non-ASCII text is MIME-encoded, so user-provided names cannot inject headers.
 */
export function buildMime(msg: MailMessage, from: { email: string; name: string }, now: Date, messageId: string): string {
  const boundary = `nova-${messageId}`;
  const domain = from.email.split("@")[1] ?? "localhost";
  const addr = (email: string, name?: string) => (name ? `${quoteName(noBreaks(name))} <${noBreaks(email)}>` : `<${noBreaks(email)}>`);
  const part = (type: string, body: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(toBase64(new TextEncoder().encode(body)))}`;
  return [
    `From: ${addr(from.email, from.name)}`,
    `To: ${addr(msg.to, msg.toName)}`,
    `Subject: ${encodeWord(noBreaks(msg.subject))}`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${messageId}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    part("text/plain", msg.text),
    part("text/html", msg.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Minimal HTML escaping for values placed into e-mail templates. */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Shared e-mail layout: brand header, white card, footer. Inline styles only (mail clients drop <style>). */
export function emailLayout(brand: string, bodyHtml: string): string {
  return `<!doctype html><html lang="tr"><body style="margin:0;background:#f4f4f8;font-family:Arial,Helvetica,sans-serif;color:#2f2b3d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#7367f0;padding:20px 28px;color:#ffffff;font-size:20px;font-weight:bold">${escapeHtml(brand)}</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.6">${bodyHtml}</td></tr>
</table>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#8a8d93">Bu e-posta ${escapeHtml(brand)} tarafından otomatik gönderildi.</p>
</td></tr></table></body></html>`;
}
