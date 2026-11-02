import { Repository, type Statement } from "@/core";
import type { CustomerRepository } from "../application/ports";
import { CONSENT_LABELS, CUSTOMER_SEGMENTS, type CustomerDetail, type CustomerList, type CustomerQuery, type CustomerSegment, type CustomerSort, type CustomerSummary } from "../domain/customer";

const COLLECTED = "('paid','partially_refunded','refunded')";

// SQLite lower() folds ASCII only: Turkish letters are folded to ASCII on both sides so "ozturk", "öztürk" and
// "ÖZTÜRK" all find "Öztürk".
const TR_FOLD: [string, string][] = [["İ", "i"], ["I", "i"], ["ı", "i"], ["Ö", "o"], ["ö", "o"], ["Ü", "u"], ["ü", "u"], ["Ş", "s"], ["ş", "s"], ["Ç", "c"], ["ç", "c"], ["Ğ", "g"], ["ğ", "g"]];
const foldSql = (expr: string) => `lower(${TR_FOLD.reduce((acc, [a, b]) => `replace(${acc}, '${a}', '${b}')`, expr)})`;
const foldText = (s: string) => TR_FOLD.reduce((acc, [a, b]) => acc.replaceAll(a, b), s).toLowerCase();
// Latest non-withdrawn consent decision for a purpose.
const consent = (purpose: string) =>
  `COALESCE((SELECT c.granted FROM user_consents c WHERE c.user_id = u.id AND c.purpose = '${purpose}' AND c.withdrawn_at IS NULL ORDER BY c.recorded_at DESC LIMIT 1), 0)`;

/** Members = users without a staff profile. Aggregates per row; ix_orders_user_placed serves the subqueries. */
const BASE = `
  SELECT u.id, u.display_name, u.email_normalized, u.phone_e164, u.status, u.email_verified_at, u.created_at, u.last_login_at,
         (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count,
         (SELECT COALESCE(SUM(o.total_minor), 0) FROM orders o WHERE o.user_id = u.id AND o.payment_status IN ${COLLECTED}) AS total_spent,
         (SELECT MAX(o.placed_at) FROM orders o WHERE o.user_id = u.id) AS last_order_at,
         ${consent("marketing_email")} AS marketing_email,
         ${consent("marketing_sms")} AS marketing_sms
    FROM users u
   WHERE u.status IN ('active','suspended') AND NOT EXISTS (SELECT 1 FROM staff_profiles sp WHERE sp.user_id = u.id)`;

const SEGMENT_WHERE: Record<CustomerSegment, string> = {
  all: "1 = 1",
  buyers: "order_count > 0",
  no_orders: "order_count = 0",
  marketing: "(marketing_email = 1 OR marketing_sms = 1)",
  suspended: "status = 'suspended'",
};

// Sort column names come from this allowlist only.
const SORT_SQL: Record<CustomerSort, string> = {
  created_at: "created_at", last_order_at: "last_order_at", total_spent: "total_spent", order_count: "order_count", name: "display_name COLLATE NOCASE",
};

type Raw = {
  id: string; display_name: string; email_normalized: string; phone_e164: string | null; status: "active" | "suspended"; email_verified_at: string | null;
  created_at: string; last_login_at: string | null; order_count: number; total_spent: number; last_order_at: string | null; marketing_email: number; marketing_sms: number;
};

const summaryOf = (r: Raw): CustomerSummary => ({
  id: r.id, name: r.display_name, email: r.email_normalized, phone: r.phone_e164, status: r.status, emailVerified: !!r.email_verified_at,
  createdAt: r.created_at, lastLoginAt: r.last_login_at, orderCount: r.order_count, totalSpentMinor: r.total_spent, lastOrderAt: r.last_order_at,
  marketingEmail: r.marketing_email === 1, marketingSms: r.marketing_sms === 1,
});

export class D1CustomerRepository extends Repository implements CustomerRepository {
  async list(q: CustomerQuery): Promise<CustomerList> {
    const search: string[] = [];
    const params: unknown[] = [];
    if (q.q) {
      const like = `%${foldText(q.q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const digits = q.q.replace(/\D/g, "");
      const or = [`${foldSql("display_name")} LIKE ? ESCAPE '\\'`, "email_normalized LIKE ? ESCAPE '\\'"];
      params.push(like, like);
      if (digits.length >= 3) {
        or.push("phone_e164 LIKE ?");
        params.push(`%${digits}%`);
      }
      search.push(`(${or.join(" OR ")})`);
    }
    const searchSql = search.length ? `WHERE ${search.join(" AND ")}` : "";
    const nulls = q.sort === "last_order_at" ? "last_order_at IS NULL, " : "";
    const [page, counts] = await this.db.batch([
      this.db.statement(
        `WITH c AS (${BASE}) SELECT *, COUNT(*) OVER () AS total FROM c ${searchSql ? `${searchSql} AND` : "WHERE"} ${SEGMENT_WHERE[q.segment]}
          ORDER BY ${nulls}${SORT_SQL[q.sort]} ${q.dir === "asc" ? "ASC" : "DESC"}, id LIMIT ? OFFSET ?`,
        ...params, q.pageSize, (q.page - 1) * q.pageSize,
      ),
      this.db.statement(
        `WITH c AS (${BASE}) SELECT ${(Object.keys(CUSTOMER_SEGMENTS) as CustomerSegment[]).map((s) => `COALESCE(SUM(${SEGMENT_WHERE[s]}), 0) AS "${s}"`).join(", ")} FROM c ${searchSql}`,
        ...params,
      ),
    ]);
    const rows = (page?.results ?? []) as (Raw & { total: number })[];
    const c = ((counts?.results ?? [])[0] ?? {}) as Record<CustomerSegment, number>;
    return {
      rows: rows.map(summaryOf),
      total: rows[0]?.total ?? 0,
      segmentCounts: Object.fromEntries((Object.keys(CUSTOMER_SEGMENTS) as CustomerSegment[]).map((s) => [s, Number(c[s] ?? 0)])) as Record<CustomerSegment, number>,
    };
  }

  async find(id: string, now: string): Promise<CustomerDetail | null> {
    const [base, profile, stats, addresses, consents, orders, sessions] = await this.db.batch([
      this.db.statement(`${BASE} AND u.id = ?`, id),
      this.db.statement(
        `SELECT cp.first_name, cp.last_name, cp.company_name, cp.notes_internal, ac.password_changed_at
           FROM users u LEFT JOIN customer_profiles cp ON cp.user_id = u.id LEFT JOIN auth_credentials ac ON ac.user_id = u.id WHERE u.id = ?`, id,
      ),
      this.db.statement(
        `SELECT COALESCE(SUM(payment_status IN ${COLLECTED}), 0) AS paid, MIN(placed_at) AS first_order_at,
                (SELECT COALESCE(SUM(r.amount_minor), 0) FROM refunds r JOIN payments p ON p.id = r.payment_id JOIN orders o2 ON o2.id = p.order_id
                  WHERE o2.user_id = ? AND r.status = 'succeeded') AS refunded
           FROM orders WHERE user_id = ?`, id, id,
      ),
      this.db.statement(
        `SELECT id, label, recipient_name, phone_e164, province, district, line1, is_default_shipping, is_default_billing
           FROM addresses WHERE user_id = ? ORDER BY is_default_shipping DESC, label`, id,
      ),
      this.db.statement("SELECT purpose, granted, document_version, recorded_at, withdrawn_at FROM user_consents WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 50", id),
      this.db.statement("SELECT id, order_number, placed_at, status, payment_status, total_minor FROM orders WHERE user_id = ? ORDER BY placed_at DESC LIMIT 20", id),
      this.db.statement("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?", id, now),
    ]);
    const b = (base?.results ?? [])[0] as Raw | undefined;
    if (!b) return null;
    const p = ((profile?.results ?? [])[0] ?? {}) as { first_name: string | null; last_name: string | null; company_name: string | null; notes_internal: string | null; password_changed_at: string | null };
    const st = ((stats?.results ?? [])[0] ?? {}) as { paid: number; first_order_at: string | null; refunded: number };
    const summary = summaryOf(b);
    const [fallbackFirst, ...rest] = summary.name.split(" ");
    return {
      ...summary,
      firstName: p.first_name ?? fallbackFirst ?? "", lastName: p.last_name ?? rest.join(" "), companyName: p.company_name, notes: p.notes_internal,
      passwordChangedAt: p.password_changed_at,
      activeSessions: Number(((sessions?.results ?? [])[0] as { n?: number } | undefined)?.n ?? 0),
      stats: {
        paidOrderCount: st.paid ?? 0, averageOrderMinor: st.paid ? Math.round(summary.totalSpentMinor / st.paid) : 0,
        firstOrderAt: st.first_order_at ?? null, refundedMinor: st.refunded ?? 0,
      },
      addresses: ((addresses?.results ?? []) as { id: string; label: string; recipient_name: string; phone_e164: string; province: string; district: string; line1: string; is_default_shipping: number; is_default_billing: number }[])
        .map((a) => ({ id: a.id, label: a.label, recipientName: a.recipient_name, phone: a.phone_e164, province: a.province, district: a.district, line1: a.line1, isDefaultShipping: a.is_default_shipping === 1, isDefaultBilling: a.is_default_billing === 1 })),
      consents: ((consents?.results ?? []) as { purpose: string; granted: number; document_version: string; recorded_at: string; withdrawn_at: string | null }[])
        .map((c) => ({ purpose: c.purpose, label: CONSENT_LABELS[c.purpose] ?? c.purpose, granted: c.granted === 1, version: c.document_version, recordedAt: c.recorded_at, withdrawnAt: c.withdrawn_at })),
      orders: ((orders?.results ?? []) as { id: string; order_number: string; placed_at: string; status: string; payment_status: string; total_minor: number }[])
        .map((o) => ({ id: o.id, orderNumber: o.order_number, placedAt: o.placed_at, status: o.status, paymentStatus: o.payment_status, totalMinor: o.total_minor })),
    };
  }

  async emailExists(email: string): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS hit FROM users WHERE email_normalized = ?", email)) !== null;
  }

  async isCustomer(id: string): Promise<boolean> {
    return (await this.db.first("SELECT 1 AS hit FROM users u WHERE u.id = ? AND NOT EXISTS (SELECT 1 FROM staff_profiles sp WHERE sp.user_id = u.id)", id)) !== null;
  }

  insertUserStatement(u: { id: string; email: string; displayName: string; phone: string | null; now: string }): Statement {
    return this.db.statement(
      "INSERT INTO users (id, email_normalized, phone_e164, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
      u.id, u.email, u.phone, u.displayName, u.now, u.now,
    );
  }

  upsertProfileStatement(userId: string, p: { firstName: string; lastName: string; companyName: string | null; notes: string | null }, now: string): Statement {
    return this.db.statement(
      `INSERT INTO customer_profiles (user_id, first_name, last_name, company_name, notes_internal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, company_name = excluded.company_name,
                                           notes_internal = excluded.notes_internal, updated_at = excluded.updated_at`,
      userId, p.firstName, p.lastName, p.companyName, p.notes, now, now,
    );
  }

  updateUserStatement(id: string, u: { displayName: string; phone: string | null }, now: string): Statement {
    return this.db.statement(
      "UPDATE users SET display_name = ?, phone_e164 = ?, updated_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM staff_profiles WHERE user_id = ?)",
      u.displayName, u.phone, now, id, id,
    );
  }

  assignCustomerRoleStatement(userId: string): Statement {
    return this.db.statement("INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT ?, id FROM roles WHERE code = 'customer'", userId);
  }

  setStatusStatement(id: string, status: "active" | "suspended", now: string): Statement {
    return this.db.statement(
      "UPDATE users SET status = ?, updated_at = ? WHERE id = ? AND status <> ? AND NOT EXISTS (SELECT 1 FROM staff_profiles WHERE user_id = ?)",
      status, now, id, status, id,
    );
  }

  consentStatement(c: { id: string; userId: string; purpose: string; version: string; granted: boolean; now: string }): Statement {
    return this.db.statement(
      "INSERT INTO user_consents (id, user_id, purpose, document_version, granted, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
      c.id, c.userId, c.purpose, c.version, c.granted ? 1 : 0, c.now,
    );
  }
}
