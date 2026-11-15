import { Repository, type Statement } from "@/core";
import type { NewsletterRepository, StoredSubscriber } from "../application/ports";
import {
  SUBSCRIBER_TABS, type SubscriberQuery, type SubscriberRow, type SubscriberSort, type SubscriberSource, type SubscriberStatus, type SubscriberTab,
} from "../domain/newsletter";

const STORED = "SELECT id, email, status, user_id, confirm_sent_at, confirm_expires_at FROM newsletter_subscribers";
type StoredRaw = { id: string; email: string; status: SubscriberStatus; user_id: string | null; confirm_sent_at: string | null; confirm_expires_at: string | null };
const storedOf = (r: StoredRaw | null): StoredSubscriber | null =>
  r ? { id: r.id, email: r.email, status: r.status, userId: r.user_id, confirmSentAt: r.confirm_sent_at, confirmExpiresAt: r.confirm_expires_at } : null;

const TAB_WHERE: Record<SubscriberTab, string> = { all: "1", subscribed: "status = 'subscribed'", pending: "status = 'pending'", unsubscribed: "status = 'unsubscribed'" };
const SORT_SQL: Record<SubscriberSort, string> = { created_at: "created_at", email: "email", confirmed_at: "confirmed_at IS NULL, confirmed_at" };
const BASE = `SELECT s.id, s.email, s.status, s.source, s.user_id, s.created_at, s.confirmed_at, s.unsubscribed_at,
                     COALESCE(NULLIF(trim(COALESCE(cp.first_name, '') || ' ' || COALESCE(cp.last_name, '')), ''), u.display_name) AS member_name
                FROM newsletter_subscribers s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN customer_profiles cp ON cp.user_id = s.user_id`;
type Raw = {
  id: string; email: string; status: SubscriberStatus; source: SubscriberSource; user_id: string | null; created_at: string; confirmed_at: string | null;
  unsubscribed_at: string | null; member_name: string | null;
};

export class D1NewsletterRepository extends Repository implements NewsletterRepository {
  async findByEmail(email: string) {
    return storedOf(await this.db.first<StoredRaw>(`${STORED} WHERE email = ?`, email));
  }

  async find(id: string) {
    return storedOf(await this.db.first<StoredRaw>(`${STORED} WHERE id = ?`, id));
  }

  async findByToken(tokenHash: string, now: string) {
    return storedOf(await this.db.first<StoredRaw>(`${STORED} WHERE confirm_token_hash = ? AND status = 'pending' AND confirm_expires_at > ?`, tokenHash, now));
  }

  async memberIdByEmail(email: string): Promise<string | null> {
    return (await this.db.first<{ id: string }>(
      "SELECT u.id FROM users u JOIN customer_profiles cp ON cp.user_id = u.id WHERE u.email_normalized = ? AND u.status = 'active'", email,
    ))?.id ?? null;
  }

  insertStatement(r: { id: string; email: string; userId: string | null; source: SubscriberSource; consentVersion: string; tokenHash: string; expiresAt: string; ipHash: string; now: string }): Statement {
    return this.db.statement(
      `INSERT INTO newsletter_subscribers (id, email, status, user_id, source, consent_version, confirm_token_hash, confirm_expires_at, confirm_sent_at, ip_hash, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.id, r.email, r.userId, r.source, r.consentVersion, r.tokenHash, r.expiresAt, r.now, r.ipHash, r.now, r.now,
    );
  }

  renewStatement(r: { id: string; from: SubscriberStatus; userId: string | null; consentVersion: string; tokenHash: string; expiresAt: string; ipHash: string; now: string }): Statement {
    return this.db.statement(
      `UPDATE newsletter_subscribers SET status = 'pending', user_id = COALESCE(?, user_id), consent_version = ?, confirm_token_hash = ?, confirm_expires_at = ?,
              confirm_sent_at = ?, ip_hash = ?, updated_at = ?
        WHERE id = ? AND status = ?`,
      r.userId, r.consentVersion, r.tokenHash, r.expiresAt, r.now, r.ipHash, r.now, r.id, r.from,
    );
  }

  confirmStatement(id: string, tokenHash: string, now: string): Statement {
    return this.db.statement(
      `UPDATE newsletter_subscribers SET status = 'subscribed', confirmed_at = ?, unsubscribed_at = NULL, confirm_token_hash = NULL, confirm_expires_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'pending' AND confirm_token_hash = ?`,
      now, now, id, tokenHash,
    );
  }

  unsubscribeStatement(id: string, now: string): Statement {
    return this.db.statement(
      `UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = ?, confirm_token_hash = NULL, confirm_expires_at = NULL, updated_at = ?
        WHERE id = ? AND status IN ('pending','subscribed')`,
      now, now, id,
    );
  }

  deleteStatement(id: string): Statement {
    return this.db.statement("DELETE FROM newsletter_subscribers WHERE id = ?", id);
  }

  consentStatement(c: { id: string; userId: string | null; guestHash: string | null; version: string; granted: boolean; now: string }): Statement {
    return this.db.statement(
      "INSERT INTO user_consents (id, user_id, guest_identity_hash, purpose, document_version, granted, recorded_at) VALUES (?, ?, ?, 'marketing_email', ?, ?, ?)",
      c.id, c.userId, c.guestHash, c.version, c.granted ? 1 : 0, c.now,
    );
  }

  async list(q: SubscriberQuery) {
    const params: unknown[] = [];
    let search = "1";
    if (q.q) {
      search = "(email LIKE ? ESCAPE '\\' OR member_name LIKE ? ESCAPE '\\')";
      const like = `%${q.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(like, like);
    }
    const [page, counts] = await this.db.batch([
      this.db.statement(
        `WITH c AS (${BASE}) SELECT *, COUNT(*) OVER () AS total FROM c WHERE ${search} AND ${TAB_WHERE[q.tab]}
          ORDER BY ${SORT_SQL[q.sort]} ${q.dir === "asc" ? "ASC" : "DESC"}, id LIMIT ? OFFSET ?`,
        ...params, q.pageSize, (q.page - 1) * q.pageSize,
      ),
      this.db.statement(
        `WITH c AS (${BASE}) SELECT ${(Object.keys(SUBSCRIBER_TABS) as SubscriberTab[]).map((t) => `COALESCE(SUM(${TAB_WHERE[t]}), 0) AS "${t}"`).join(", ")} FROM c WHERE ${search}`,
        ...params,
      ),
    ]);
    const rows = (page?.results ?? []) as (Raw & { total: number })[];
    const c = ((counts?.results ?? [])[0] ?? {}) as Record<SubscriberTab, number>;
    return {
      rows: rows.map((r): SubscriberRow => ({
        id: r.id, email: r.email, status: r.status, source: r.source, isMember: r.user_id !== null, memberName: r.member_name,
        createdAt: r.created_at, confirmedAt: r.confirmed_at, unsubscribedAt: r.unsubscribed_at,
      })),
      total: Number(rows[0]?.total ?? 0),
      counts: Object.fromEntries((Object.keys(SUBSCRIBER_TABS) as SubscriberTab[]).map((t) => [t, Number(c[t] ?? 0)])) as Record<SubscriberTab, number>,
    };
  }
}
