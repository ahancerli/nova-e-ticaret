import { Repository, type Statement } from "@/core";
import type { MailDeliveryRecord, MailDeliveryRepository } from "../application/ports";
import type { MailDeliveryStatus, MailDeliveryView, MailPurpose } from "../domain/mail";

type Raw = {
  id: string; purpose: MailPurpose; recipient: string; status: MailDeliveryStatus; smtp_host: string | null; stage: string | null; error_code: string | null;
  error_message: string | null; server_reply: string | null; latency_ms: number | null; created_at: string;
};
const cut = (v: string | null | undefined, n: number) => (v ? v.slice(0, n) : null);

export class D1MailDeliveryRepository extends Repository implements MailDeliveryRepository {
  recordStatements(r: MailDeliveryRecord & { id: string; now: string }, pruneBefore: string): Statement[] {
    return [
      this.db.statement(
        `INSERT INTO mail_deliveries (id, purpose, recipient, status, smtp_host, stage, error_code, error_message, server_reply, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.id, r.purpose, r.recipient.slice(0, 254), r.status, cut(r.smtpHost, 253), cut(r.stage, 20), cut(r.errorCode, 60), cut(r.errorMessage, 500),
        cut(r.serverReply, 500), r.latencyMs ?? null, r.now,
      ),
      this.db.statement("DELETE FROM mail_deliveries WHERE created_at < ?", pruneBefore),
    ];
  }

  async latest(limit: number): Promise<MailDeliveryView[]> {
    const rows = await this.db.all<Raw>(
      `SELECT id, purpose, recipient, status, smtp_host, stage, error_code, error_message, server_reply, latency_ms, created_at
         FROM mail_deliveries ORDER BY created_at DESC, rowid DESC LIMIT ?`, limit,
    );
    return rows.map((r) => ({
      id: r.id, purpose: r.purpose, recipient: r.recipient, status: r.status, smtpHost: r.smtp_host, stage: r.stage, errorCode: r.error_code,
      errorMessage: r.error_message, serverReply: r.server_reply, latencyMs: r.latency_ms, createdAt: r.created_at,
    }));
  }
}
