import type { AppError } from "@/core";
import { MailErrors } from "./errors";
import type { SmtpSecurity } from "./presets";

/** Where in the SMTP session it failed. */
export type SmtpStage = "connect" | "tls" | "greeting" | "ehlo" | "starttls" | "auth" | "sender" | "recipient" | "data";

/** Raw facts about a failure, collected by the wire client (infrastructure/smtp-client.ts). */
export interface SmtpFailure {
  stage: SmtpStage;
  /** Reply code of the rejecting command, e.g. 535. */
  smtpCode?: number;
  /** The server's reply text (never contains our credentials). */
  reply?: string;
  /** Node / OpenSSL error code, e.g. ENOTFOUND, ERR_SSL_WRONG_VERSION_NUMBER. */
  sysCode?: string;
  /** Node error message (TLS errors carry the useful part there). */
  message?: string;
  timeout?: boolean;
  closed?: boolean;
  /** EHLO did not offer what the step needs (STARTTLS / AUTH). */
  notOffered?: boolean;
}

const CERT = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/;
const WRONG_TLS = /wrong version number|packet length too long|unknown protocol|WRONG_VERSION_NUMBER|ssl3_get_record|http request/i;
const GMAIL = /(^|\.)(gmail|googlemail|google)\.com$/i;
const LIMIT = /\b5\.4\.5\b|\b4\.7\.28\b|daily (user )?sending|sending (quota|limit)|quota exceeded|limit exceeded|too many (messages|recipients)/i;

const clip = (s: string | undefined, n = 300) => (s ? s.replace(/\s+/g, " ").trim().slice(0, n) : undefined);

/**
 * Failure facts → the MailErrors entry that tells the admin which setting is wrong. Order matters: network and TLS
 * problems first (they decide host / port / security), then the reply of the failing step. Pure; unit-tested.
 */
export function classifySmtpFailure(f: SmtpFailure, server: { host: string; port: number; security: SmtpSecurity }): AppError {
  const reply = f.reply ?? "";
  const enhanced = /\b([245]\.\d{1,3}\.\d{1,3})\b/.exec(reply)?.[1];
  const d = { stage: f.stage, smtpCode: f.smtpCode, enhanced, reply: clip(reply), sysCode: f.sysCode, reason: f.smtpCode ? undefined : clip(f.message, 160) };
  const gmail = GMAIL.test(server.host);
  const sys = `${f.sysCode ?? ""} ${f.message ?? ""}`;

  // network / TLS
  if (/ENOTFOUND|EAI_AGAIN|EAI_NONAME/.test(sys)) return MailErrors.hostNotFound(server.host, d);
  if (/ECONNREFUSED/.test(sys)) return MailErrors.connectRefused(server.host, server.port, d);
  if (WRONG_TLS.test(sys)) return MailErrors.securityMismatch(server.port, d);
  if (CERT.test(f.sysCode ?? "")) return MailErrors.tlsCertificate(server.host, d);
  if (f.timeout && f.stage === "connect") return MailErrors.connectTimeout(server.port, d);
  // STARTTLS on an implicit-TLS port (465): the server waits for a TLS hello, we wait for its greeting.
  if ((f.timeout || f.closed) && (f.stage === "greeting" || f.stage === "tls")) return MailErrors.securityMismatch(server.port, d);
  if (/EHOSTUNREACH|ENETUNREACH|ECONNRESET/.test(sys) && f.stage === "connect") return MailErrors.connectFailed(d);
  if (f.stage === "starttls") return f.smtpCode && f.smtpCode < 500 && f.smtpCode >= 400 ? MailErrors.temporary(d) : MailErrors.starttlsUnsupported(d);
  if (f.smtpCode === 530 && /STARTTLS/i.test(reply)) return MailErrors.securityMismatch(server.port, d);

  // authentication
  if (f.stage === "auth") {
    if (f.notOffered) return MailErrors.authUnsupported(d);
    if (f.smtpCode === 534 || enhanced === "5.7.9" || /application-specific password|InvalidSecondFactor/i.test(reply)) return MailErrors.appPasswordRequired(d);
    if (/SmtpClientAuthentication is disabled|basic authentication is disabled|\b5\.7\.139\b|\b5\.7\.3\b/i.test(reply)) return MailErrors.authDisabled(d);
    if (f.smtpCode === 504) return MailErrors.authUnsupported(d);
    if (f.smtpCode && f.smtpCode >= 400 && f.smtpCode < 500) return MailErrors.temporary(d);
    if (f.smtpCode) return MailErrors.authFailed(gmail, d);
  }

  // envelope / message
  if (LIMIT.test(reply)) return MailErrors.sendingLimit(d);
  if (f.smtpCode && f.smtpCode >= 400 && f.smtpCode < 500) return MailErrors.temporary(d);
  if (f.smtpCode && f.stage === "sender") return MailErrors.senderRejected(gmail, d);
  if (f.smtpCode && f.stage === "recipient") return MailErrors.recipientRejected(d);
  if (f.stage === "data" && (f.smtpCode === 552 || enhanced === "5.3.4")) return MailErrors.messageTooLarge(d);
  if (f.stage === "data" && f.smtpCode) return MailErrors.messageRejected(d);

  if (f.timeout) return MailErrors.timeout(d);
  if (f.closed) return MailErrors.connectionClosed(d);
  if (f.smtpCode) return MailErrors.rejected(d);
  return MailErrors.connectFailed(d);
}
