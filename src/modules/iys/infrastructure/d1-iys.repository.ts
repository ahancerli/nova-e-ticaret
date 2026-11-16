import { Repository, type Statement } from "@/core";
import type { IysChannel, IysEnvironment, IysQueueRow, IysQueueState, IysSettingsView, IysStatus } from "../domain/iys";

type SettingsRow = {
  is_active: number; environment: IysEnvironment; iys_code: string | null; brand_code: string | null; username: string | null; password_ciphertext: string | null;
  password_nonce: string | null; password_auth_tag: string | null; changes_cursor: string | null; last_push_at: string | null; last_pull_at: string | null;
  last_error: string | null; updated_at: string;
};

export interface IysStoredSettings extends IysSettingsView {
  sealedPassword: { ciphertext: string; nonce: string; authTag: string } | null;
  changesCursor: string | null;
}

export interface QueueItem { consentId: string | null; channel: IysChannel; recipient: string; status: IysStatus; consentAt: string }

type QueueRaw = { id: string; channel: IysChannel; recipient: string; status: IysStatus; consent_at: string; source: string; state: IysQueueState; attempts: number; error: string | null; sent_at: string | null; created_at: string; transaction_id: string | null };
const toRow = (r: QueueRaw): IysQueueRow & { source: string; transactionId: string | null } => ({
  id: r.id, channel: r.channel, recipient: r.recipient, status: r.status, consentAt: r.consent_at, state: r.state, attempts: r.attempts, error: r.error,
  sentAt: r.sent_at, createdAt: r.created_at, source: r.source, transactionId: r.transaction_id,
});

export class D1IysRepository extends Repository {
  async settings(): Promise<IysStoredSettings> {
    const r = await this.db.first<SettingsRow>("SELECT * FROM iys_settings WHERE id = 1");
    return {
      isActive: r?.is_active === 1, environment: r?.environment ?? "sandbox", iysCode: r?.iys_code ?? null, brandCode: r?.brand_code ?? null, username: r?.username ?? null,
      passwordSet: !!r?.password_ciphertext, lastPushAt: r?.last_push_at ?? null, lastPullAt: r?.last_pull_at ?? null, lastError: r?.last_error ?? null, updatedAt: r?.updated_at ?? "",
      sealedPassword: r?.password_ciphertext && r.password_nonce && r.password_auth_tag ? { ciphertext: r.password_ciphertext, nonce: r.password_nonce, authTag: r.password_auth_tag } : null,
      changesCursor: r?.changes_cursor ?? null,
    };
  }

  /** Guarded by updated_at; `password` null keeps the stored one. */
  saveStatement(s: { isActive: boolean; environment: IysEnvironment; iysCode: string; brandCode: string; username: string; password: { ciphertext: string; nonce: string; authTag: string; keyVersion: string } | null; actorId: string; now: string; expectedUpdatedAt: string }): Statement {
    return this.db.statement(
      `UPDATE iys_settings SET is_active = ?, environment = ?, iys_code = ?, brand_code = ?, username = ?,
              password_ciphertext = COALESCE(?, password_ciphertext), password_nonce = COALESCE(?, password_nonce), password_auth_tag = COALESCE(?, password_auth_tag),
              password_key_version = COALESCE(?, password_key_version), last_error = NULL, updated_by = ?, updated_at = ?
        WHERE id = 1 AND updated_at = ?`,
      s.isActive ? 1 : 0, s.environment, s.iysCode, s.brandCode, s.username, s.password?.ciphertext ?? null, s.password?.nonce ?? null, s.password?.authTag ?? null,
      s.password?.keyVersion ?? null, s.actorId, s.now, s.expectedUpdatedAt,
    );
  }

  async noteSync(p: { pushAt?: string; pullAt?: string; cursor?: string | null; error: string | null }): Promise<void> {
    await this.db.run(
      `UPDATE iys_settings SET last_push_at = COALESCE(?, last_push_at), last_pull_at = COALESCE(?, last_pull_at),
              changes_cursor = CASE WHEN ? THEN ? ELSE changes_cursor END, last_error = ? WHERE id = 1`,
      p.pushAt ?? null, p.pullAt ?? null, p.cursor !== undefined ? 1 : 0, p.cursor ?? null, p.error,
    );
  }

  enqueueStatement(id: string, q: QueueItem, state: IysQueueState, now: string): Statement {
    return this.db.statement(
      `INSERT INTO iys_queue (id, user_consent_id, channel, recipient, status, consent_at, state, next_attempt_at, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_consent_id) DO NOTHING`,
      id, q.consentId, q.channel, q.recipient, q.status, q.consentAt, state, now, state === "skipped" ? "İYS yalnız Türkiye cep telefonlarını kabul eder." : null, now,
    );
  }

  async due(now: string, limit: number) {
    return (await this.db.all<QueueRaw>("SELECT * FROM iys_queue WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY created_at, rowid LIMIT ?", now, limit)).map(toRow);
  }

  async markSent(id: string, transactionId: string | null, now: string) {
    await this.db.run("UPDATE iys_queue SET state = 'sent', transaction_id = ?, sent_at = ?, error = NULL, attempts = attempts + 1 WHERE id = ? AND state = 'pending'", transactionId, now, id);
  }

  async markFailed(id: string, error: string) {
    await this.db.run("UPDATE iys_queue SET state = 'failed', error = ?, attempts = attempts + 1 WHERE id = ? AND state = 'pending'", error.slice(0, 1000), id);
  }

  async markRetry(id: string, error: string, attempts: number, next: string) {
    await this.db.run("UPDATE iys_queue SET attempts = ?, next_attempt_at = ?, error = ? WHERE id = ? AND state = 'pending'", attempts, next, error.slice(0, 1000), id);
  }

  async retryFailed(now: string): Promise<number> {
    return (await this.db.run("UPDATE iys_queue SET state = 'pending', attempts = 0, next_attempt_at = ?, error = NULL WHERE state = 'failed'", now)).changes;
  }

  async counts(): Promise<Record<IysQueueState, number>> {
    const rows = await this.db.all<{ state: IysQueueState; n: number }>("SELECT state, COUNT(*) AS n FROM iys_queue GROUP BY state");
    const out = { pending: 0, sent: 0, failed: 0, skipped: 0 };
    for (const r of rows) out[r.state] = r.n;
    return out;
  }

  async overdue(before: string): Promise<number> {
    return Number((await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM iys_queue WHERE state IN ('pending','failed') AND consent_at < ?", before))?.n ?? 0);
  }

  async recent(limit: number) {
    return (await this.db.all<QueueRaw>("SELECT * FROM iys_queue ORDER BY CASE state WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, created_at DESC LIMIT ?", limit)).map(toRow);
  }

  async ownTransaction(transactionId: string): Promise<boolean> {
    return !!(await this.db.first("SELECT 1 AS hit FROM iys_queue WHERE transaction_id = ?", transactionId));
  }

  /** Latest status we hold for a recipient on a channel (queue rows, newest first). */
  async lastStatus(channel: IysChannel, recipient: string): Promise<IysStatus | null> {
    return (await this.db.first<{ status: IysStatus }>("SELECT status FROM iys_queue WHERE channel = ? AND recipient = ? ORDER BY consent_at DESC, rowid DESC LIMIT 1", channel, recipient))?.status ?? null;
  }

  /**
   * Current consents never queued (go-live / backfill): members' latest marketing_email / marketing_sms decision and
   * confirmed newsletter subscribers. Only granted ones (İYS needs no RET for someone who never said yes).
   */
  async unqueuedGrants(limit: number): Promise<{ consentId: string; purpose: string; recordedAt: string; email: string | null; phone: string | null }[]> {
    return this.db.all(
      `SELECT c.id AS consentId, c.purpose, c.recorded_at AS recordedAt,
              COALESCE(u.email_normalized, (SELECT ns.email FROM newsletter_subscribers ns WHERE ns.status = 'subscribed' AND c.guest_identity_hash IS NOT NULL AND ns.user_id IS NULL
                                              AND ns.confirmed_at = c.recorded_at LIMIT 1)) AS email,
              u.phone_e164 AS phone
         FROM user_consents c LEFT JOIN users u ON u.id = c.user_id
        WHERE c.purpose IN ('marketing_email','marketing_sms') AND c.granted = 1 AND c.withdrawn_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM iys_queue q WHERE q.user_consent_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM user_consents x WHERE x.purpose = c.purpose AND x.recorded_at > c.recorded_at
                            AND ((c.user_id IS NOT NULL AND x.user_id = c.user_id) OR (c.guest_identity_hash IS NOT NULL AND x.guest_identity_hash = c.guest_identity_hash)))
        ORDER BY c.recorded_at LIMIT ?`,
      limit,
    );
  }

  // --- pulled changes ----------------------------------------------------------------------------------------------
  async memberByEmail(email: string) {
    return this.db.first<{ id: string }>("SELECT id FROM users WHERE email_normalized = ?", email);
  }

  async memberByPhone(phone: string) {
    return this.db.first<{ id: string }>("SELECT id FROM users WHERE phone_e164 = ?", phone);
  }

  /** Evidence row for a decision made at İYS (document_version 'iys'); not queued again. */
  consentStatement(c: { id: string; userId: string | null; guestHash: string | null; purpose: string; granted: boolean; at: string }): Statement {
    return this.db.statement(
      "INSERT INTO user_consents (id, user_id, guest_identity_hash, purpose, document_version, granted, recorded_at) VALUES (?, ?, ?, ?, 'iys', ?, ?)",
      c.id, c.userId, c.guestHash, c.purpose, c.granted ? 1 : 0, c.at,
    );
  }

  /** İYS said RET for an e-mail: the newsletter stops too. */
  unsubscribeNewsletterStatement(email: string, now: string): Statement {
    return this.db.statement(
      "UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = ?, updated_at = ? WHERE email = ? AND status IN ('pending','subscribed')", now, now, email,
    );
  }
}
