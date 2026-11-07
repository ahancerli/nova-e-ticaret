import type { Statement } from "@/core";
import type { MailDeliveryStatus, MailDeliveryView, MailMessage, MailPurpose, SmtpSecurity } from "../domain/mail";

export interface SealedPassword {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: string;
}

export interface StoredMailIntegration {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: SealedPassword;
  fromEmail: string;
  fromName: string;
  updatedAt: string;
  updatedByName: string | null;
}

export type MailIntegrationRow = Omit<StoredMailIntegration, "password" | "updatedAt" | "updatedByName">;

export interface MailIntegrationRepository {
  find(): Promise<StoredMailIntegration | null>;
  insertStatement(row: MailIntegrationRow & { password: SealedPassword; actorId: string; now: string }): Statement;
  /** Guarded on `expectedUpdatedAt`; `password` null = keep the stored one. */
  updateStatement(row: MailIntegrationRow & { password: SealedPassword | null; actorId: string; now: string }, expectedUpdatedAt: string): Statement;
  deleteStatement(expectedUpdatedAt: string): Statement;
}

export interface SmtpServer {
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
}

/** Delivers one MIME message (Strategy; tests replace it). Throws classified MailErrors; returns the server's accept line. */
export interface SmtpTransport {
  send(server: SmtpServer, envelope: { from: string; to: string }, mime: string): Promise<{ serverReply: string }>;
}

export interface MailDeliveryRecord {
  purpose: MailPurpose;
  recipient: string;
  status: MailDeliveryStatus;
  smtpHost?: string | null;
  stage?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  serverReply?: string | null;
  latencyMs?: number | null;
}

export interface MailDeliveryRepository {
  /** Insert + prune rows older than `pruneBefore`. */
  recordStatements(row: MailDeliveryRecord & { id: string; now: string }, pruneBefore: string): Statement[];
  latest(limit: number): Promise<MailDeliveryView[]>;
}

/**
 * What other modules depend on to send mail. "not_configured" = no SMTP settings yet (caller decides: log in
 * development, report in production). Transport failures throw.
 */
export interface MailSender {
  send(message: MailMessage): Promise<"sent" | "not_configured">;
  /** Records a mail that was deliberately not sent (e.g. reset requested again within the resend window). */
  note(purpose: MailPurpose, recipient: string, status: "throttled"): Promise<void>;
}
