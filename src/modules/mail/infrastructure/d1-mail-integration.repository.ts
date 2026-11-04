import { Repository, type Statement } from "@/core";
import type { MailIntegrationRepository, MailIntegrationRow, SealedPassword, StoredMailIntegration } from "../application/ports";
import type { SmtpSecurity } from "../domain/mail";

type Raw = {
  host: string; port: number; security: SmtpSecurity; username: string; password_ciphertext: string; password_nonce: string; password_auth_tag: string;
  key_version: string; from_email: string; from_name: string; updated_at: string; updated_by_name: string | null;
};

export class D1MailIntegrationRepository extends Repository implements MailIntegrationRepository {
  async find(): Promise<StoredMailIntegration | null> {
    const r = await this.db.first<Raw>(
      `SELECT m.host, m.port, m.security, m.username, m.password_ciphertext, m.password_nonce, m.password_auth_tag, m.key_version,
              m.from_email, m.from_name, m.updated_at, u.display_name AS updated_by_name
         FROM mail_integration m LEFT JOIN users u ON u.id = m.updated_by WHERE m.id = 'default'`,
    );
    if (!r) return null;
    return {
      host: r.host, port: r.port, security: r.security, username: r.username, fromEmail: r.from_email, fromName: r.from_name,
      updatedAt: r.updated_at, updatedByName: r.updated_by_name,
      password: { ciphertext: r.password_ciphertext, nonce: r.password_nonce, authTag: r.password_auth_tag, keyVersion: r.key_version },
    };
  }

  insertStatement(row: MailIntegrationRow & { password: SealedPassword; actorId: string; now: string }): Statement {
    return this.db.statement(
      `INSERT INTO mail_integration (id, host, port, security, username, password_ciphertext, password_nonce, password_auth_tag, key_version,
                                     from_email, from_name, updated_by, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.host, row.port, row.security, row.username, row.password.ciphertext, row.password.nonce, row.password.authTag, row.password.keyVersion,
      row.fromEmail, row.fromName, row.actorId, row.now,
    );
  }

  updateStatement(row: MailIntegrationRow & { password: SealedPassword | null; actorId: string; now: string }, expectedUpdatedAt: string): Statement {
    const base = [row.host, row.port, row.security, row.username, row.fromEmail, row.fromName, row.actorId, row.now];
    if (!row.password) {
      return this.db.statement(
        `UPDATE mail_integration SET host = ?, port = ?, security = ?, username = ?, from_email = ?, from_name = ?, updated_by = ?, updated_at = ?
          WHERE id = 'default' AND updated_at = ?`,
        ...base, expectedUpdatedAt,
      );
    }
    return this.db.statement(
      `UPDATE mail_integration SET host = ?, port = ?, security = ?, username = ?, from_email = ?, from_name = ?, updated_by = ?, updated_at = ?,
              password_ciphertext = ?, password_nonce = ?, password_auth_tag = ?, key_version = ?
        WHERE id = 'default' AND updated_at = ?`,
      ...base, row.password.ciphertext, row.password.nonce, row.password.authTag, row.password.keyVersion, expectedUpdatedAt,
    );
  }

  deleteStatement(expectedUpdatedAt: string): Statement {
    return this.db.statement("DELETE FROM mail_integration WHERE id = 'default' AND updated_at = ?", expectedUpdatedAt);
  }
}
